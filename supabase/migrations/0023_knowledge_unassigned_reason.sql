-- Per-chunk reason recorded when a chunk is shelved as unassigned at ingest, so the
-- review UI can show why each chunk matched no agent (e.g. 'header', 'low_relevance',
-- 'no_embedding') instead of guessing from content length at display time.
-- Null for assigned/normal chunks.

ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS unassigned_reason text;
