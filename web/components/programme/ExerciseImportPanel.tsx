"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { useAgentStream } from "@/lib/useAgentStream";
import Spinner from "@/components/dashboard/Spinner";
import ThoughtLine, { plainThought } from "@/components/dashboard/ThoughtLine";
import LiveSources from "@/components/dashboard/LiveSources";
import { MuscleIcon, GROUP_ICON } from "./MuscleMap";

// Trainer-only panel: research a NEW exercise via AI search / a pasted link / a
// pasted-or-uploaded file, preview the structured candidate, then add it to the
// global exercise_db. Mounted at the top of the Programme library.

type Lang = { en?: string; zh?: string };
type Candidate = {
  name?: string;
  name_zh?: string;
  muscle_group?: string;
  primary_muscles?: string[];
  secondary_muscles?: string[];
  equipment?: string;
  equipment_options?: string[];
  level?: string;
  difficulty?: number;
  tempo?: string;
  cues?: string;
  key_points?: Record<string, Lang>;
  progression?: Lang;
  regression?: Lang;
  common_faults?: Lang[];
  variations?: { name?: Lang; level?: string; equipment?: string[] }[];
  duplicate_of?: string | null;
  sources?: { title: string; url?: string | null }[];
};

export default function ExerciseImportPanel() {
  const { t, locale } = useI18n();
  const router = useRouter();
  const stream = useAgentStream();
  const fileRef = useRef<HTMLInputElement>(null);

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [url, setUrl] = useState("");
  const [fileText, setFileText] = useState("");
  const [fileName, setFileName] = useState("");
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const [photo, setPhoto] = useState<{ url: string; alt: string | null } | null>(null);
  const [showCandPhoto, setShowCandPhoto] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [added, setAdded] = useState<string | null>(null);

  const busy = stream.running;
  const latestThought = stream.thoughts[stream.thoughts.length - 1];
  const L = (v?: Lang | null) => (v ? (locale === "zh" ? v.zh || v.en : v.en || v.zh) : "");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    try {
      const text = await f.text();
      setFileText(text.slice(0, 20000));
    } catch {
      setError(t("import.fileError"));
    }
  }

  async function research() {
    setError(null);
    setCandidate(null);
    setPhoto(null);
    setAdded(null);
    if (!query.trim() && !url.trim() && !fileText.trim()) {
      setError(t("import.needInput"));
      return;
    }
    try {
      const payload = await stream.start("/api/ai/exercise-research/stream", {
        query: query.trim() || undefined,
        url: url.trim() || undefined,
        article_text: fileText.trim() || undefined,
      });
      const p = payload as { exercise?: Candidate; error?: string } | null;
      if (p?.error) setError(p.error);
      else if (p?.exercise) {
        setCandidate(p.exercise);
        loadPhoto(p.exercise);
      } else setError(t("import.parseError"));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function loadPhoto(ex: Candidate) {
    try {
      const params = new URLSearchParams({ name: ex.name ?? "" });
      if (ex.muscle_group) params.set("mg", ex.muscle_group);
      const r = await fetch(`/api/exercises/image?${params}`);
      if (r.ok) {
        const d = await r.json();
        if (d?.url) setPhoto({ url: d.url, alt: d.alt ?? null });
      }
    } catch { /* keep muscle-icon fallback */ }
  }

  async function addToLibrary() {
    if (!candidate) return;
    setAdding(true);
    setError(null);
    try {
      const r = await fetch("/api/exercises", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(candidate),
      });
      const data = await r.json();
      if (!r.ok) {
        setError(data?.error === "duplicate_name" ? t("import.duplicate") : (data?.error || "error"));
        return;
      }
      setAdded(data.name || candidate.name || "");
      setCandidate(null);
      setPhoto(null);
      setQuery(""); setUrl(""); setFileText(""); setFileName("");
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setAdding(false);
    }
  }

  const inputStyle: React.CSSProperties = {
    background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8,
    padding: "8px 10px", color: T.text, fontSize: 12, outline: "none", width: "100%",
  };
  const groupIcon = candidate?.muscle_group ? GROUP_ICON[candidate.muscle_group] : null;

  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: 16, display: "flex", flexDirection: "column", gap: 12, flexShrink: 0 }}>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="import-toggle"
        style={{ background: "none", border: "none", cursor: "pointer", color: T.text, fontSize: 13, fontWeight: 600, display: "flex", gap: 8, alignItems: "center", padding: 0, textAlign: "left" }}
      >
        <span>{open ? "▾" : "▸"}</span>
        <span>✨ {t("import.title")}</span>
        <span style={{ fontSize: 11, color: T.muted, fontWeight: 400 }}>{t("import.subtitle")}</span>
      </button>

      {open && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("import.queryPlaceholder")} style={inputStyle} data-testid="import-query" />
            <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder={t("import.urlPlaceholder")} style={inputStyle} data-testid="import-url" />
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <input ref={fileRef} type="file" accept=".txt,.md,.csv,.json,.html" onChange={onFile} style={{ display: "none" }} />
              <button onClick={() => fileRef.current?.click()} style={{ ...chipBtn, cursor: "pointer" }}>📎 {t("import.uploadFile")}</button>
              {fileName && <span style={{ fontSize: 11, color: T.mutedMid }}>{fileName} {fileText && `(${fileText.length} ${t("import.chars")})`}</span>}
            </div>
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <button
              onClick={research}
              disabled={busy}
              data-testid="run-import"
              style={{
                fontSize: 12, padding: "8px 16px", borderRadius: 99,
                background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
                border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600,
                cursor: busy ? "not-allowed" : "pointer", opacity: busy ? 0.7 : 1,
              }}
            >
              {busy ? <Spinner emoji="🔎" label={plainThought(latestThought) ?? t("common.generating")} /> : t("import.research")}
            </button>
            {added && <span style={{ fontSize: 12, color: "#a7c39c" }}>✅ {t("import.added")} — {added}</span>}
          </div>

          {busy && <LiveSources sources={stream.sources} />}

          {busy && stream.thoughts.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "8px 12px", background: "rgba(0,0,0,0.18)", borderRadius: 8, borderLeft: `2px solid ${T.border}`, maxHeight: 120, overflowY: "auto" }}>
              {stream.thoughts.map((line, i) => (
                <div key={i} style={{ fontSize: 11, color: T.muted, lineHeight: 1.45, fontFamily: T.font.mono, opacity: i === stream.thoughts.length - 1 ? 1 : 0.55 }}>
                  <ThoughtLine line={line} />
                </div>
              ))}
            </div>
          )}

          {error && <div data-testid="import-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{error}</div>}

          {candidate && (
            <div data-testid="import-candidate" style={{ background: "rgba(0,0,0,0.2)", borderRadius: 12, padding: 16, border: `1px solid ${T.border}`, display: "flex", flexDirection: "column", gap: 12 }}>
              {candidate.duplicate_of && (
                <div style={{ fontSize: 11, color: "#fbbf24", display: "flex", gap: 6 }}>
                  ⚠️ {t("import.maybeDuplicate")} <strong>{candidate.duplicate_of}</strong>
                </div>
              )}

              <div style={{ display: "flex", gap: 14, alignItems: "flex-start" }}>
                {/* primary = target muscle group */}
                {groupIcon ? <MuscleIcon regions={groupIcon.regions} view={groupIcon.view} size={54} active /> : null}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 16, fontWeight: 700, color: T.text }}>{candidate.name}</div>
                  {candidate.name_zh && <div style={{ fontSize: 13, color: T.mutedMid }}>{candidate.name_zh}</div>}
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                    {candidate.muscle_group && <Tag>{candidate.muscle_group}</Tag>}
                    {candidate.equipment && <Tag>{candidate.equipment}</Tag>}
                    {candidate.level && <Tag>{candidate.level}</Tag>}
                    {candidate.tempo && <Tag>{t("programme.tempo")} {candidate.tempo}</Tag>}
                  </div>
                </div>
              </div>

              {/* gym demonstration photo — collapsed */}
              {photo && (
                <div>
                  <button onClick={() => setShowCandPhoto((s) => !s)}
                    style={{ background: "none", border: "none", cursor: "pointer", color: T.mutedMid, fontSize: 11, fontWeight: 600, display: "flex", gap: 5, alignItems: "center", padding: 0 }}>
                    {showCandPhoto ? "▾" : "▸"} 📷 {t("programme.demoPhoto")}
                  </button>
                  {showCandPhoto && (
                    <div style={{ width: 120, height: 120, borderRadius: 12, overflow: "hidden", background: "#f4f4f2", position: "relative", marginTop: 8 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain" }} />
                      {photo.alt && (
                        <>
                          <style>{`@keyframes imp-frameSwap { 0%,45% { opacity: 0 } 55%,100% { opacity: 1 } }`}</style>
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={photo.alt} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "contain", animation: "imp-frameSwap 1.6s ease-in-out infinite" }} />
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {candidate.cues && <div style={{ fontSize: 12, color: T.mutedMid }}>💡 {candidate.cues}</div>}

              {(candidate.primary_muscles?.length || candidate.secondary_muscles?.length) ? (
                <div style={{ fontSize: 11, color: T.muted, display: "flex", gap: 16, flexWrap: "wrap" }}>
                  {candidate.primary_muscles?.length ? <span><strong style={{ color: "#e4c08c" }}>{t("programme.primary")}:</strong> {candidate.primary_muscles.join(", ")}</span> : null}
                  {candidate.secondary_muscles?.length ? <span><strong>{t("programme.secondary")}:</strong> {candidate.secondary_muscles.join(", ")}</span> : null}
                </div>
              ) : null}

              {candidate.key_points && (
                <details>
                  <summary style={{ fontSize: 11, color: "#e4c08c", cursor: "pointer", fontWeight: 600 }}>{t("programme.keyPoints")}</summary>
                  <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 6 }}>
                    {Object.entries(candidate.key_points).map(([k, v]) => (
                      <div key={k} style={{ fontSize: 11, color: T.muted }}><strong style={{ color: T.mutedMid }}>{k}:</strong> {L(v)}</div>
                    ))}
                  </div>
                </details>
              )}

              {(candidate.progression || candidate.regression) && (
                <div style={{ fontSize: 11, color: T.muted, display: "flex", flexDirection: "column", gap: 3 }}>
                  {candidate.progression && <span>📈 <strong>{t("programme.progression")}:</strong> {L(candidate.progression)}</span>}
                  {candidate.regression && <span>📉 <strong>{t("programme.regression")}:</strong> {L(candidate.regression)}</span>}
                </div>
              )}

              {candidate.variations?.length ? (
                <div style={{ fontSize: 11, color: T.muted }}>
                  <strong style={{ color: "#e4c08c" }}>{t("programme.variations")}:</strong> {candidate.variations.map((v) => L(v.name)).filter(Boolean).join(" · ")}
                </div>
              ) : null}

              {candidate.sources?.length ? (
                <div style={{ fontSize: 10, color: T.muted }}>
                  {t("program.sources")}: {candidate.sources.map((s, i) => (
                    s.url ? <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, marginRight: 8 }}>{s.title || s.url}</a> : <span key={i} style={{ marginRight: 8 }}>{s.title}</span>
                  ))}
                </div>
              ) : null}

              <div style={{ display: "flex", gap: 10 }}>
                <button
                  onClick={addToLibrary}
                  disabled={adding}
                  data-testid="confirm-add-exercise"
                  style={{
                    fontSize: 12, padding: "8px 16px", borderRadius: 99,
                    background: "linear-gradient(135deg, rgba(122,148,140,0.95) 0%, rgba(72,98,90,0.95) 100%)",
                    border: "1px solid rgba(255,252,245,0.25)", color: "#fffdf6", fontWeight: 600,
                    cursor: adding ? "not-allowed" : "pointer", opacity: adding ? 0.7 : 1,
                  }}
                >
                  {adding ? <Spinner emoji="💾" label={t("import.adding")} /> : `➕ ${t("import.addToLibrary")}`}
                </button>
                <button onClick={() => setCandidate(null)} style={{ ...chipBtn, cursor: "pointer" }}>{t("import.discard")}</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const chipBtn: React.CSSProperties = {
  fontSize: 11, padding: "6px 12px", borderRadius: 99, border: `1px solid ${T.border}`,
  background: "transparent", color: T.mutedMid,
};

function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "rgba(196,148,82,0.16)", color: "#e4c08c", textTransform: "uppercase", letterSpacing: "0.04em" }}>
      {children}
    </span>
  );
}
