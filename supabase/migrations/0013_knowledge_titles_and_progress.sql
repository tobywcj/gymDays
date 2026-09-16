-- Per-chunk short title (3-5 words) for mind-map visualisation
ALTER TABLE knowledge_chunks
  ADD COLUMN IF NOT EXISTS title text;

-- Ingestion progress stage for the loading UI
ALTER TABLE knowledge_docs
  ADD COLUMN IF NOT EXISTS progress_stage text,
  ADD COLUMN IF NOT EXISTS progress_done  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS progress_total int NOT NULL DEFAULT 0;
