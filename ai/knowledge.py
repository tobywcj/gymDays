"""Knowledge base ingestion pipeline.

Extracts text from URLs, PDFs, DOCX, PPTX, and plain articles;
semantically chunks using LlamaIndex; auto-tags each chunk with Haiku;
stores embeddings in knowledge_chunks via pgvector.
"""
from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
import time
from io import BytesIO
from pathlib import Path
from typing import TYPE_CHECKING

import httpx

from ai.config import ANTHROPIC_API_KEY, OPENAI_API_KEY
from ai.db import get_db
from ai.embeddings import embed

if TYPE_CHECKING:
    from llama_index.core.schema import BaseNode, Document

# ── Constants ────────────────────────────────────────────────────────────────

AGENT_TAGS = ["progress", "planner", "nutrition", "messaging"]
_JINA_BASE = "https://r.jina.ai"

# Sentinel tag for chunks no agent is relevant to. The chunk is kept (not deleted)
# but matches no agent at retrieval time, so an unclassifiable chunk is shelved for
# trainer review instead of being broadcast to every agent (which is what an empty
# agent_tags array means). See classify_by_embedding / ingest_doc.
UNASSIGNED_TAG = "__unassigned__"

# Short domain descriptions for the embedding-similarity fallback, used when the
# Haiku classifier returns no tags. Kept in step with the agent definitions in
# ai/crew/agents.py.
AGENT_DOMAINS: dict[str, str] = {
    "progress":  "training analysis, performance metrics, training load monitoring, recovery, readiness, fatigue, HRV, plateaus",
    "planner":   "workout programming, exercise selection, sets and reps, periodization, weekly training plan design",
    "nutrition": "food, diet, macronutrients, protein, calories, supplements, meal timing, eating habits",
    "messaging": "client communication, motivation, coaching check-ins, accountability, adherence, encouragement",
}

# Cosine-similarity gates for the embedding fallback (tunable via env so they can be
# calibrated without a code change). A chunk is tagged for an agent only if its best
# match clears the floor; agents within _MARGIN of that best score are also included
# so genuinely cross-cutting content reaches every agent it earns.
_FALLBACK_SIM_FLOOR  = float(os.environ.get("KB_FALLBACK_SIM_FLOOR", "0.32"))
_FALLBACK_SIM_MARGIN = float(os.environ.get("KB_FALLBACK_SIM_MARGIN", "0.05"))

# Minimum characters for a chunk to stand on its own. Shorter fragments (section
# headings, table-of-contents lines, exam-format blurbs) carry no retrievable
# substance, so they're merged into the following chunk at ingest. Tunable via env.
_MIN_CHUNK_CHARS = int(os.environ.get("KB_MIN_CHUNK_CHARS", "150"))


# ── Text extraction ──────────────────────────────────────────────────────────

def extract_documents(
    source_type: str,
    *,
    file_bytes: bytes | None = None,
    filename: str | None = None,
    url: str | None = None,
    article_text: str | None = None,
) -> list["Document"]:
    """Return a list of LlamaIndex Documents for the given source."""
    from llama_index.core import Document as LIDoc

    if source_type == "url":
        if not url:
            raise ValueError("url required for source_type='url'")
        text = _fetch_url(url)
        return [LIDoc(text=text, metadata={"source": url})]

    if source_type == "article":
        if not article_text:
            raise ValueError("article_text required for source_type='article'")
        return [LIDoc(text=article_text)]

    if source_type in ("pdf", "docx", "pptx"):
        if not file_bytes:
            raise ValueError(f"file_bytes required for source_type='{source_type}'")
        return _load_file(source_type, file_bytes, filename or f"upload.{source_type}")

    raise ValueError(f"Unknown source_type: {source_type!r}")


def _fetch_url(url: str) -> str:
    """Fetch a URL via Jina Reader → returns clean markdown text."""
    jina_url = f"{_JINA_BASE}/{url}"
    resp = httpx.get(jina_url, headers={"Accept": "text/plain"}, timeout=30, follow_redirects=True)
    resp.raise_for_status()
    return resp.text


def _load_file(source_type: str, file_bytes: bytes, filename: str) -> list["Document"]:
    """Write bytes to a temp file, load with LlamaIndex readers."""
    from llama_index.core import SimpleDirectoryReader

    suffix = Path(filename).suffix or f".{source_type}"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(file_bytes)
        tmp_path = tmp.name

    try:
        docs = SimpleDirectoryReader(input_files=[tmp_path]).load_data()
    finally:
        Path(tmp_path).unlink(missing_ok=True)

    return docs


# ── Semantic chunking ────────────────────────────────────────────────────────

def chunk_documents(docs: list["Document"]) -> list["BaseNode"]:
    """Semantically chunk documents. Falls back to sentence splitting without OpenAI key."""
    if OPENAI_API_KEY:
        try:
            from llama_index.core.node_parser import SemanticSplitterNodeParser
            from llama_index.embeddings.openai import OpenAIEmbedding
            from ai.config import EMBED_MODEL

            splitter = SemanticSplitterNodeParser(
                embed_model=OpenAIEmbedding(model=EMBED_MODEL, api_key=OPENAI_API_KEY),
                breakpoint_percentile_threshold=95,
                buffer_size=1,
            )
            return splitter.get_nodes_from_documents(docs)
        except Exception:
            pass  # fall through to sentence splitter

    # Fallback: fixed sentence splitter
    from llama_index.core.node_parser import SentenceSplitter
    splitter = SentenceSplitter(chunk_size=600, chunk_overlap=80)
    return splitter.get_nodes_from_documents(docs)


# ── Auto-tagging ─────────────────────────────────────────────────────────────

def classify_chunk(content: str) -> tuple[str, list[str]]:
    """Single Haiku call → (short_title, agent_tags).

    Returns ("", []) on any failure / missing key.
    """
    if not ANTHROPIC_API_KEY:
        return "", []

    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=120,
            messages=[{
                "role": "user",
                "content": (
                    "You are tagging a piece of fitness coaching content so the right AI "
                    "agents can retrieve it. Knowledge is shared, not owned: when a passage "
                    "is DIRECTLY useful to several agents, tag all of them. But only tag an "
                    "agent when the chunk would genuinely help it do its job — never add an "
                    "agent for a passing mention or a weak, tangential connection.\n\n"
                    "Agents available:\n"
                    "- 'progress': training analysis, performance metrics, load monitoring, recovery\n"
                    "- 'planner': workout programming, exercise selection, periodization\n"
                    "- 'nutrition': food, diet, macros, supplements, eating habits\n"
                    "- 'messaging': client communication, motivation, check-ins\n\n"
                    "Tagging rules:\n"
                    "- Include an agent ONLY if the passage is substantively, directly about "
                    "that agent's domain — something it would actually use to advise a client.\n"
                    "- Multiple tags are good WHEN earned: tag every agent that clears that "
                    "bar, but do not pad the list with low-relevance agents.\n"
                    "- A brief or incidental reference to a domain is NOT enough to tag it.\n"
                    "- Use [] ONLY for general background that is genuinely useful to every "
                    "agent — an empty list means the chunk is shared with all agents.\n\n"
                    "Return ONLY a JSON object with two fields:\n"
                    "  - \"title\": 3-6 words summarising the chunk (Title Case)\n"
                    "  - \"tags\":  JSON array of the agents the chunk DIRECTLY serves, or [] for "
                    "general/shared content\n\n"
                    "Examples:\n"
                    "  {\"title\":\"Protein Timing After Training\",\"tags\":[\"nutrition\",\"progress\"]}\n"
                    "  {\"title\":\"Deload Week Programming\",\"tags\":[\"planner\",\"progress\"]}\n"
                    "  {\"title\":\"Building Client Rapport\",\"tags\":[\"messaging\"]}\n"
                    "  {\"title\":\"Principles Of Progressive Overload\",\"tags\":[]}\n\n"
                    f"Text:\n{content[:600]}"
                ),
            }],
        )
        raw = msg.content[0].text.strip()
        # Extract JSON object
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start >= 0 and end > start:
            data = json.loads(raw[start:end])
            title = str(data.get("title") or "").strip()[:80]
            tags = [t for t in (data.get("tags") or []) if t in AGENT_TAGS]
            return title, tags
    except Exception:
        pass

    return "", []


# Back-compat: keep the old name for any callers
def auto_tag_chunk(content: str) -> list[str]:
    return classify_chunk(content)[1]


# ── Embedding-similarity fallback ────────────────────────────────────────────
# When the LLM classifier returns no tags, we don't broadcast the chunk to every
# agent. Instead we cosine-match its embedding against each agent's domain and tag
# only the agents it is genuinely close to — and shelve it as unassigned if none.

_domain_vecs: dict[str, list[float]] | None = None


def _agent_domain_vectors() -> dict[str, list[float]]:
    """Embed each agent's domain description once and cache it for the process."""
    global _domain_vecs
    if _domain_vecs is None:
        _domain_vecs = {}
        for tag, desc in AGENT_DOMAINS.items():
            v = embed(desc)
            if v is not None:
                _domain_vecs[tag] = v
    return _domain_vecs


def _cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    return dot / (na * nb) if na and nb else 0.0


def classify_by_embedding(vec: list[float] | None) -> list[str]:
    """Fallback tagger: cosine-match a chunk embedding to each agent's domain.

    Returns the agents the chunk is genuinely close to (the best match plus any
    within _FALLBACK_SIM_MARGIN of it), or [] when nothing clears the relevance
    floor — in which case the caller shelves the chunk as unassigned.
    """
    if not vec:
        return []
    domains = _agent_domain_vectors()
    if not domains:
        return []
    scored = sorted(
        ((tag, _cosine(vec, dvec)) for tag, dvec in domains.items()),
        key=lambda kv: kv[1],
        reverse=True,
    )
    best = scored[0][1]
    if best < _FALLBACK_SIM_FLOOR:
        return []
    return [tag for tag, s in scored if s >= best - _FALLBACK_SIM_MARGIN]


def agent_similarity_scores(vec: list[float] | None) -> dict[str, float]:
    """Cosine similarity of a chunk embedding against every agent's domain.

    Surfaces the same nearest-agent signal the fallback tagger uses, but as raw
    per-agent scores so the trainer can see how close a shelved chunk is to each
    agent when deciding where to assign it. Returns {} when no embedding/domains.
    """
    if not vec:
        return {}
    domains = _agent_domain_vectors()
    if not domains:
        return {}
    return {tag: _cosine(vec, dvec) for tag, dvec in domains.items()}


# ── Chunk hygiene ────────────────────────────────────────────────────────────

def merge_short_chunks(texts: list[str], min_chars: int = _MIN_CHUNK_CHARS) -> list[str]:
    """Glue heading-only / too-short fragments onto the next chunk so standalone
    section titles don't become their own (unsearchable) chunks. A trailing short
    fragment is appended to the previous chunk; if the whole doc is tiny it's kept
    rather than dropped (no data loss)."""
    merged: list[str] = []
    carry = ""
    for t in texts:
        t = (t or "").strip()
        if not t:
            continue
        if carry:
            t = carry + "\n\n" + t
            carry = ""
        if len(t) < min_chars:
            carry = t  # still too short → defer to the next chunk
            continue
        merged.append(t)
    if carry:
        if merged:
            merged[-1] = merged[-1] + "\n\n" + carry
        else:
            merged.append(carry)
    return merged


def shelf_reason(text: str, vec: list[float] | None) -> str:
    """Authoritative reason a chunk is shelved unassigned, captured at ingest where
    we know whether it was embeddable and how long it is.

    'no_embedding'  — couldn't embed it (no embedding key), so no agent match possible
    'header'        — too short to carry retrievable substance (heading / TOC line)
    'low_relevance' — has body text but matched no agent's domain above the floor
    """
    if vec is None:
        return "no_embedding"
    if len((text or "").strip()) < _MIN_CHUNK_CHARS:
        return "header"
    return "low_relevance"


def unassigned_reason(content: str) -> str:
    """Content-only display fallback for chunks shelved before the reason was stored."""
    return "header" if len((content or "").strip()) < _MIN_CHUNK_CHARS else "low_relevance"


# ── Per-agent "what this doc teaches me" bullets ────────────────────────────────
# Each agent gets its OWN bullets for a doc, derived ONLY from the chunks explicitly
# tagged for that agent — untagged/shared and unassigned chunks contribute to no
# agent's bullets. So the same doc reads differently in the Nutrition vs Planner card.

def summarize_agent_doc(agent: str, chunk_texts: list[str], title: str = "") -> list[str]:
    """Single Haiku call → 2-4 bullet points of what `agent` learns from a doc.

    `chunk_texts` must already be filtered to the chunks this agent retrieves.
    Returns [] on any failure / missing key / no chunks.
    """
    if not ANTHROPIC_API_KEY or not chunk_texts:
        return []

    role = AGENT_DOMAINS.get(agent, agent)
    joined = "\n\n---\n\n".join(t[:700] for t in chunk_texts[:12])
    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": (
                    f"The '{agent}' agent ({role}) can retrieve the excerpts below from a "
                    f"document titled \"{title or '(untitled)'}\".\n\n"
                    "Write 2-4 short bullet points describing what THIS agent specifically "
                    "learns or can apply from these excerpts. Be concrete and grounded in the "
                    "text — no generic filler, no agent-name prefix. Each bullet ≤ 16 words.\n\n"
                    "Return ONLY a JSON array of strings, e.g. [\"...\", \"...\"]\n\n"
                    f"Excerpts:\n{joined}"
                ),
            }],
        )
        raw = msg.content[0].text.strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start >= 0 and end > start:
            arr = json.loads(raw[start:end])
            bullets = [str(b).strip()[:160] for b in arr if str(b).strip()]
            return bullets[:4]
    except Exception:
        pass
    return []


# ── Summary translation ─────────────────────────────────────────────────────
# Bullets are generated once in English (BASE_SUMMARY_LANG) and cached on the doc.
# For any other app-UI locale we translate them once and cache per-locale in
# knowledge_docs.agent_summaries_i18n, so the trainer reads them in their dashboard
# language. A locale/agent without a cached translation falls back to the English.

BASE_SUMMARY_LANG = "en"
_SUMMARY_LANG_NAMES: dict[str, str] = {
    "zh": "Traditional Chinese (繁體中文)",
    "en": "English",
}


def translate_bullets(bullets: list[str], lang: str) -> list[str]:
    """Translate a list of short bullet strings into `lang` with one Haiku call.

    Returns [] on any failure / missing key / unknown language so callers fall
    back to the cached base bullets rather than showing nothing.
    """
    target = _SUMMARY_LANG_NAMES.get(lang)
    if not ANTHROPIC_API_KEY or not bullets or not target or lang == BASE_SUMMARY_LANG:
        return []
    try:
        from anthropic import Anthropic
        client = Anthropic(api_key=ANTHROPIC_API_KEY)
        msg = client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=400,
            messages=[{
                "role": "user",
                "content": (
                    f"Translate each bullet point below into {target}. Keep the fitness/"
                    "coaching meaning precise, keep them short, and preserve the order and "
                    "count exactly. Do not add or drop bullets.\n\n"
                    "Return ONLY a JSON array of the translated strings.\n\n"
                    f"Bullets:\n{json.dumps(bullets, ensure_ascii=False)}"
                ),
            }],
        )
        raw = msg.content[0].text.strip()
        start = raw.find("[")
        end = raw.rfind("]") + 1
        if start >= 0 and end > start:
            arr = json.loads(raw[start:end])
            out = [str(b).strip()[:200] for b in arr if str(b).strip()]
            # Only trust a translation that preserved the bullet count — a mismatch
            # means the model dropped/merged lines, so fall back to the base instead.
            if len(out) == len(bullets):
                return out
    except Exception:
        pass
    return []


def backfill_agent_summary_translations(trainer_id: str, lang: str) -> None:
    """Ensure every (doc, agent) base summary has a cached `lang` translation.

    Mirrors backfill_agent_summaries: already-translated pairs are skipped, so the
    per-card refresh / repeat loads are cheap. No-op for the base language or an
    unsupported locale. Best-effort — a failed translation just leaves the pair to
    fall back to the English bullets at read time.
    """
    if lang == BASE_SUMMARY_LANG or lang not in _SUMMARY_LANG_NAMES:
        return
    db = get_db()
    try:
        docs = (db.table("knowledge_docs")
                .select("id, agent_summaries, agent_summaries_i18n")
                .eq("trainer_id", trainer_id)
                .eq("status", "ready")
                .execute().data) or []
    except Exception:
        return

    # Build the list of missing (doc, agent) translation jobs.
    jobs: list[tuple[str, str, list[str]]] = []  # (doc_id, agent, base_bullets)
    existing: dict[str, dict] = {}
    for d in docs:
        base = d.get("agent_summaries") or {}
        cur_lang = dict((d.get("agent_summaries_i18n") or {}).get(lang) or {})
        existing[d["id"]] = cur_lang
        for agent, bullets in base.items():
            if bullets and not cur_lang.get(agent):
                jobs.append((d["id"], agent, bullets))
    if not jobs:
        return

    from collections import defaultdict
    from concurrent.futures import ThreadPoolExecutor
    updates: dict[str, dict] = defaultdict(dict)
    with ThreadPoolExecutor(max_workers=min(6, len(jobs))) as pool:
        for doc_id, agent, translated in pool.map(
            lambda j: (j[0], j[1], translate_bullets(j[2], lang)), jobs
        ):
            if translated:
                updates[doc_id][agent] = translated

    for doc_id, new_map in updates.items():
        # Merge this locale's freshly translated pairs over what's already cached,
        # then nest it back under the locale key without disturbing other locales.
        doc = next((x for x in docs if x["id"] == doc_id), None)
        all_i18n = dict((doc or {}).get("agent_summaries_i18n") or {})
        all_i18n[lang] = {**existing.get(doc_id, {}), **new_map}
        try:
            db.table("knowledge_docs").update(
                {"agent_summaries_i18n": all_i18n}
            ).eq("id", doc_id).execute()
        except Exception:
            pass  # one failed write shouldn't break the rest


def _agent_chunk_texts(rows: list[dict]) -> dict[str, list[str]]:
    """Group chunk contents by the agents EXPLICITLY tagged on each chunk.

    Only chunks whose agent_tags contain the agent contribute to that agent's bullets.
    Untagged (empty) and unassigned chunks contribute to no agent.
    """
    out: dict[str, list[str]] = {a: [] for a in AGENT_TAGS}
    for r in rows:
        if not r.get("content"):
            continue
        for a in (r.get("agent_tags") or []):
            if a in out:
                out[a].append(r["content"])
    return out


def _agent_doc_signatures(rows: list[dict]) -> dict[str, str]:
    """Per-agent fingerprint of the chunks that feed its summary for one doc.

    Hashes the sorted ids of the chunks explicitly tagged for each agent (the same
    set _agent_chunk_texts summarises). Equal signatures ⇒ the summary was built from
    the same assigned chunks, so a refresh can skip regeneration; a newly assigned (or
    removed) chunk shifts the signature and triggers exactly one regeneration.
    """
    ids_by_agent: dict[str, list[str]] = {a: [] for a in AGENT_TAGS}
    for r in rows:
        if not r.get("content"):
            continue
        for a in (r.get("agent_tags") or []):
            if a in ids_by_agent:
                ids_by_agent[a].append(str(r.get("id")))
    return {
        a: hashlib.sha1(",".join(sorted(ids)).encode()).hexdigest()
        for a, ids in ids_by_agent.items() if ids
    }


def generate_agent_summaries(rows: list[dict], title: str = "") -> dict[str, list[str]]:
    """Build the per-agent bullets map for a single doc's chunk rows (parallel)."""
    by_agent = _agent_chunk_texts(rows)
    present = [a for a in AGENT_TAGS if by_agent[a]]
    if not present:
        return {}

    from concurrent.futures import ThreadPoolExecutor
    result: dict[str, list[str]] = {}
    with ThreadPoolExecutor(max_workers=len(present)) as pool:
        for a, bullets in pool.map(lambda a: (a, summarize_agent_doc(a, by_agent[a], title)), present):
            if bullets:
                result[a] = bullets
    return result


def backfill_agent_summaries(trainer_id: str) -> None:
    """Generate/refresh per-agent bullets for each (doc, agent) pair as needed.

    A pair is (re)generated only when it has no summary yet OR its chunk signature has
    changed — i.e. a chunk was assigned to (or removed from) that agent on that doc. If
    a doc gained no new assigned chunks, its signature still matches and it's skipped,
    so the per-card refresh button costs nothing for unchanged docs. Runs the needed
    jobs in parallel and stores the new signature alongside the bullets.
    """
    db = get_db()
    try:
        docs = (db.table("knowledge_docs")
                .select("id, title, agent_summaries, agent_summaries_sig, agent_summaries_i18n")
                .eq("trainer_id", trainer_id)
                .eq("status", "ready")
                .execute().data) or []
    except Exception:
        return
    if not docs:
        return

    try:
        chunks = (db.table("knowledge_chunks")
                  .select("id, doc_id, content, agent_tags")
                  .eq("trainer_id", trainer_id)
                  .order("chunk_index")
                  .execute().data) or []
    except Exception:
        return

    # chunk rows grouped by doc
    rows_by_doc: dict[str, list[dict]] = {}
    for c in chunks:
        rows_by_doc.setdefault(c["doc_id"], []).append(c)

    # Build the list of (doc, agent) jobs that are missing or stale (signature drift).
    jobs: list[tuple[str, str, str, list[str]]] = []  # (doc_id, title, agent, texts)
    existing: dict[str, dict] = {}
    sigs_by_doc: dict[str, dict] = {}
    for d in docs:
        cur = dict(d.get("agent_summaries") or {})
        cur_sig = dict(d.get("agent_summaries_sig") or {})
        existing[d["id"]] = cur
        by_agent = _agent_chunk_texts(rows_by_doc.get(d["id"], []))
        sigs = _agent_doc_signatures(rows_by_doc.get(d["id"], []))
        sigs_by_doc[d["id"]] = sigs
        for a, texts in by_agent.items():
            # Regenerate when there's no summary yet, or the assigned-chunk set changed.
            if texts and (not cur.get(a) or cur_sig.get(a) != sigs.get(a)):
                jobs.append((d["id"], d.get("title") or "", a, texts))
    if not jobs:
        return

    from collections import defaultdict
    from concurrent.futures import ThreadPoolExecutor
    updates: dict[str, dict] = defaultdict(dict)
    with ThreadPoolExecutor(max_workers=min(6, len(jobs))) as pool:
        for doc_id, agent, bullets in pool.map(
            lambda j: (j[0], j[2], summarize_agent_doc(j[2], j[3], j[1])), jobs
        ):
            if bullets:
                updates[doc_id][agent] = bullets

    doc_by_id = {d["id"]: d for d in docs}
    for doc_id, new_map in updates.items():
        merged = {**existing.get(doc_id, {}), **new_map}
        # Record the signature only for agents we actually regenerated, so a failed
        # LLM call leaves the old signature and the pair is retried next time.
        merged_sig = {
            **(doc_by_id[doc_id].get("agent_summaries_sig") or {}),
            **{a: sigs_by_doc[doc_id][a] for a in new_map if a in sigs_by_doc.get(doc_id, {})},
        }
        # The English bullets changed, so any stored translation of them is now stale —
        # drop the regenerated agents from every locale so they re-translate on demand.
        i18n = {
            lang: {a: v for a, v in m.items() if a not in new_map}
            for lang, m in (doc_by_id[doc_id].get("agent_summaries_i18n") or {}).items()
        }
        try:
            db.table("knowledge_docs").update({
                "agent_summaries": merged,
                "agent_summaries_sig": merged_sig,
                "agent_summaries_i18n": i18n,
            }).eq("id", doc_id).execute()
        except Exception:
            pass  # one failed write shouldn't break the rest


# ── Ingest pipeline ──────────────────────────────────────────────────────────

def _set_stage(db, doc_id: str, stage: str, done: int = 0, total: int = 0) -> None:
    """Write the current ingestion stage so the UI can show progress."""
    try:
        db.table("knowledge_docs").update({
            "progress_stage": stage,
            "progress_done":  done,
            "progress_total": total,
        }).eq("id", doc_id).execute()
    except Exception:
        pass  # progress is best-effort, never block ingestion


def ingest_doc(
    trainer_id: str,
    doc_id: str,
    docs: list["Document"],
    default_tags: list[str],
) -> int:
    """Chunk, tag, embed, and store a document. Returns chunk count written."""
    db = get_db()

    _set_stage(db, doc_id, "chunking")
    nodes = chunk_documents(docs)
    # Merge heading-only / too-short fragments into the next chunk so standalone
    # section titles don't become their own unsearchable, unassignable chunks.
    texts = merge_short_chunks([n.get_content() for n in nodes])
    total = len(texts)
    _set_stage(db, doc_id, "tagging", done=0, total=total)

    rows = []
    for i, text in enumerate(texts):
        text = text.strip()
        if not text:
            continue

        title, tags = classify_chunk(text)
        vec = embed(text)
        if not tags:
            # The LLM placed this chunk with no agent. Rather than the old behaviour
            # of broadcasting it to every agent (agent_tags=[]), prefer the trainer's
            # explicit default, then an embedding-similarity match, and finally shelve
            # it as unassigned (retrievable by no agent) for trainer review.
            tags = default_tags or classify_by_embedding(vec) or [UNASSIGNED_TAG]
        row: dict = {
            "doc_id":      doc_id,
            "trainer_id":  trainer_id,
            "chunk_index": i,
            "content":     text,
            "title":       title or None,
            "agent_tags":  tags,
            # Authoritative reason for shelved chunks; null for assigned ones.
            "unassigned_reason": shelf_reason(text, vec) if tags == [UNASSIGNED_TAG] else None,
        }
        if vec is not None:
            row["embedding"] = vec
        rows.append(row)

        # Update progress every chunk so the UI can show "Tagging 12/45"
        _set_stage(db, doc_id, "tagging", done=i + 1, total=total)

    _set_stage(db, doc_id, "saving", done=0, total=len(rows))
    if rows:
        batch_size = 50
        for start in range(0, len(rows), batch_size):
            db.table("knowledge_chunks").insert(rows[start:start + batch_size]).execute()
            _set_stage(db, doc_id, "saving", done=min(start + batch_size, len(rows)), total=len(rows))

    # Per-agent "what this doc teaches me" bullets for the knowledge base UI
    # (best-effort; backfilled later if it fails).
    doc_title = ""
    try:
        doc_title = str((docs[0].metadata or {}).get("source") or "") if docs else ""
    except Exception:
        doc_title = ""
    agent_summaries = generate_agent_summaries(rows, doc_title)

    db.table("knowledge_docs").update({
        "status":          "ready",
        "chunk_count":     len(rows),
        "agent_summaries": agent_summaries,
        "progress_stage":  "ready",
        "progress_done":   len(rows),
        "progress_total":  len(rows),
    }).eq("id", doc_id).execute()

    # Read-back: confirm the row is actually queryable after commit, and how many
    # docs this trainer now has. If this count resets to 0 across restarts, the
    # write target is not the persistent DB you expect (see startup host log).
    try:
        check = db.table("knowledge_docs").select("id", count="exact") \
            .eq("trainer_id", trainer_id).execute()
        total_docs = check.count if check.count is not None else len(check.data or [])
        print(
            f"[ingest] doc {doc_id} ready ({len(rows)} chunks); "
            f"trainer {trainer_id} now has {total_docs} docs in DB",
            flush=True,
        )
    except Exception as exc:
        print(f"[ingest] read-back check failed for doc {doc_id}: {exc}", flush=True)

    return len(rows)


def ingest_doc_safe(trainer_id: str, doc_id: str, docs: list["Document"], default_tags: list[str]) -> None:
    """Ingest wrapper that marks status=error on failure (used by background tasks)."""
    try:
        ingest_doc(trainer_id, doc_id, docs, default_tags)
    except Exception as exc:
        try:
            db = get_db()
            db.table("knowledge_docs").update({
                "status":       "error",
                "error_detail": str(exc)[:500],
            }).eq("id", doc_id).execute()
        except Exception:
            pass
        raise


# ── Legacy backfill ──────────────────────────────────────────────────────────

def reclassify_broadcast_chunks(
    trainer_id: str | None = None,
    *,
    use_llm: bool = False,
) -> dict:
    """Re-scope legacy chunks that broadcast to all agents (agent_tags = []).

    These predate the per-agent fallback: an empty array means "visible to every
    agent", so a chunk meant for one agent leaks into all. Re-run the tagging
    pipeline (optional Haiku → embedding fallback → unassigned) so each is scoped
    to the agents it earns or shelved for review. Only touches unconfirmed chunks,
    and never mass-shelves: a chunk we genuinely can't classify (no embedding
    available) is left shared as-is.

    use_llm=False (default) reclassifies from embeddings only — cheap, no LLM cost.
    use_llm=True also runs the Haiku classifier first for higher precision.
    Returns a summary count dict.
    """
    db = get_db()
    q = db.table("knowledge_chunks") \
        .select("id, content, agent_tags, tags_confirmed") \
        .eq("tags_confirmed", False)
    if trainer_id:
        q = q.eq("trainer_id", trainer_id)
    rows = q.execute().data or []
    legacy = [r for r in rows if not (r.get("agent_tags"))]

    summary = {"scanned": len(legacy), "scoped": 0, "unassigned": 0, "skipped_no_embed": 0, "skipped_empty": 0}
    for c in legacy:
        content = (c.get("content") or "").strip()
        if not content:
            summary["skipped_empty"] += 1
            continue

        tags = classify_chunk(content)[1] if use_llm else []
        if not tags:
            vec = embed(content)
            if vec is None:
                # No way to classify safely — leave it shared rather than blindly
                # shelving it away from every agent.
                summary["skipped_no_embed"] += 1
                continue
            tags = classify_by_embedding(vec) or [UNASSIGNED_TAG]

        db.table("knowledge_chunks").update({"agent_tags": tags}).eq("id", c["id"]).execute()
        if tags == [UNASSIGNED_TAG]:
            summary["unassigned"] += 1
        else:
            summary["scoped"] += 1

    print(f"[reclassify] trainer={trainer_id or 'ALL'} {summary}", flush=True)
    return summary
