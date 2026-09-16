-- Cached translations of the per-agent "what this doc teaches me" bullets.
-- The base bullets live in knowledge_docs.agent_summaries (English, as generated).
-- This column caches translations keyed by app-UI locale, so the trainer reads the
-- summaries in their dashboard language without re-translating on every load.
--
-- Shape: { "zh": { "nutrition": ["要點", ...], "planner": [...] }, ... }
-- A locale/agent that isn't present yet falls back to the base (English) bullets.

ALTER TABLE knowledge_docs
  ADD COLUMN IF NOT EXISTS agent_summaries_i18n jsonb NOT NULL DEFAULT '{}'::jsonb;
