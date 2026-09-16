-- Per-agent "what this doc teaches me" bullets, keyed by agent tag.
-- Shape: { "nutrition": ["bullet", ...], "planner": [...], ... }
-- Each agent only summarises the chunks it can actually retrieve from the doc
-- (its tagged chunks + shared untagged ones), so the bullets differ per agent.

ALTER TABLE knowledge_docs
  ADD COLUMN IF NOT EXISTS agent_summaries jsonb NOT NULL DEFAULT '{}'::jsonb;
