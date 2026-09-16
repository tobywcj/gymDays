-- Knowledge base: trainer-scoped documents chunked, embedded, and assigned to agents.

CREATE TABLE IF NOT EXISTS knowledge_docs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_id   uuid NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  title        text NOT NULL,
  source_type  text NOT NULL CHECK (source_type IN ('url','pdf','docx','pptx','article')),
  source_url   text,
  default_tags text[] NOT NULL DEFAULT '{}',  -- trainer-set default; empty = all agents
  status       text NOT NULL DEFAULT 'processing' CHECK (status IN ('processing','ready','error')),
  chunk_count  int  NOT NULL DEFAULT 0,
  error_detail text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS knowledge_chunks (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id         uuid NOT NULL REFERENCES knowledge_docs(id) ON DELETE CASCADE,
  trainer_id     uuid NOT NULL REFERENCES trainers(id) ON DELETE CASCADE,
  chunk_index    int  NOT NULL,
  content        text NOT NULL,
  agent_tags     text[] NOT NULL DEFAULT '{}',   -- per-chunk auto-tags; empty = all agents
  tags_confirmed bool NOT NULL DEFAULT false,    -- true once trainer confirms or overrides
  fts            tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED,
  embedding      vector(1536),
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_embedding
  ON knowledge_chunks USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_fts
  ON knowledge_chunks USING gin(fts);

CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_doc
  ON knowledge_chunks(doc_id, chunk_index);

CREATE INDEX IF NOT EXISTS idx_knowledge_docs_trainer
  ON knowledge_docs(trainer_id, created_at DESC);

-- RLS
ALTER TABLE knowledge_docs   ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_chunks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS trainer_own_docs   ON knowledge_docs;
DROP POLICY IF EXISTS trainer_own_chunks ON knowledge_chunks;
DROP POLICY IF EXISTS service_role_docs   ON knowledge_docs;
DROP POLICY IF EXISTS service_role_chunks ON knowledge_chunks;

CREATE POLICY trainer_own_docs
  ON knowledge_docs USING (trainer_id = auth.uid());

CREATE POLICY trainer_own_chunks
  ON knowledge_chunks USING (trainer_id = auth.uid());

-- Service role bypass (for AI service writes)
CREATE POLICY service_role_docs
  ON knowledge_docs USING (auth.role() = 'service_role') WITH CHECK (true);

CREATE POLICY service_role_chunks
  ON knowledge_chunks USING (auth.role() = 'service_role') WITH CHECK (true);

-- ── Hybrid search RPC ────────────────────────────────────────────────────────
-- Combines pgvector cosine similarity with full-text search via RRF scoring.
-- p_agent_tag = '' means no filter (all chunks visible).
CREATE OR REPLACE FUNCTION match_knowledge_hybrid(
  p_trainer_id uuid,
  p_query      text,
  p_query_vec  vector(1536),
  p_agent_tag  text,
  p_limit      int DEFAULT 5
)
RETURNS TABLE(id uuid, doc_id uuid, content text, score float)
LANGUAGE sql STABLE AS $$
  WITH vector_search AS (
    SELECT kc.id, kc.doc_id, kc.content,
           ROW_NUMBER() OVER (ORDER BY kc.embedding <=> p_query_vec) AS rank
    FROM   knowledge_chunks kc
    JOIN   knowledge_docs kd ON kd.id = kc.doc_id
    WHERE  kc.trainer_id = p_trainer_id
      AND  kd.status = 'ready'
      AND  kc.embedding IS NOT NULL
      AND  (p_agent_tag = ''
            OR cardinality(kc.agent_tags) = 0
            OR p_agent_tag = ANY(kc.agent_tags))
    ORDER BY kc.embedding <=> p_query_vec
    LIMIT 20
  ),
  text_search AS (
    SELECT kc.id, kc.doc_id, kc.content,
           ROW_NUMBER() OVER (
             ORDER BY ts_rank_cd(kc.fts, plainto_tsquery('english', p_query)) DESC
           ) AS rank
    FROM   knowledge_chunks kc
    JOIN   knowledge_docs kd ON kd.id = kc.doc_id
    WHERE  kc.trainer_id = p_trainer_id
      AND  kd.status = 'ready'
      AND  kc.fts @@ plainto_tsquery('english', p_query)
      AND  (p_agent_tag = ''
            OR cardinality(kc.agent_tags) = 0
            OR p_agent_tag = ANY(kc.agent_tags))
    LIMIT 20
  )
  SELECT
    COALESCE(v.id, t.id)           AS id,
    COALESCE(v.doc_id, t.doc_id)   AS doc_id,
    COALESCE(v.content, t.content) AS content,
    COALESCE(1.0 / (60 + v.rank), 0.0)
    + COALESCE(1.0 / (60 + t.rank), 0.0) AS score
  FROM   vector_search v
  FULL OUTER JOIN text_search t ON t.id = v.id
  ORDER BY score DESC
  LIMIT p_limit;
$$;
