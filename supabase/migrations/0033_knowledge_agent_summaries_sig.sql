-- Per-agent fingerprint of the chunks each summary was generated from.
-- Shape: { "nutrition": "<sha1>", "planner": "<sha1>", ... }
--
-- Lets a refresh skip regeneration when nothing changed: if the signature of an
-- agent's currently-assigned chunks for a doc still matches the stored one, the
-- existing summary is up to date. It's regenerated only when a chunk is assigned
-- (or removed), which shifts the signature.

ALTER TABLE knowledge_docs
  ADD COLUMN IF NOT EXISTS agent_summaries_sig jsonb NOT NULL DEFAULT '{}'::jsonb;
