-- Citations: surface the source document (title + url) for every knowledge
-- chunk returned by hybrid search, so agents can cite what they used.
-- Adds title + source_url to the RETURNS TABLE and joins knowledge_docs.

-- Drop first: changing the RETURNS TABLE shape is not allowed by CREATE OR REPLACE.
DROP FUNCTION IF EXISTS match_knowledge_hybrid(uuid, text, vector, text, integer);

CREATE FUNCTION match_knowledge_hybrid(
  p_trainer_id uuid,
  p_query      text,
  p_query_vec  vector(1536),
  p_agent_tag  text,
  p_limit      int DEFAULT 5
)
RETURNS TABLE(
  id         uuid,
  doc_id     uuid,
  content    text,
  title      text,
  source_url text,
  score      float
)
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
  ),
  ranked AS (
    SELECT
      COALESCE(v.id, t.id)           AS id,
      COALESCE(v.doc_id, t.doc_id)   AS doc_id,
      COALESCE(v.content, t.content) AS content,
      COALESCE(1.0 / (60 + v.rank), 0.0)
      + COALESCE(1.0 / (60 + t.rank), 0.0) AS score
    FROM   vector_search v
    FULL OUTER JOIN text_search t ON t.id = v.id
  )
  SELECT
    r.id,
    r.doc_id,
    r.content,
    kd.title       AS title,
    kd.source_url  AS source_url,
    r.score
  FROM   ranked r
  JOIN   knowledge_docs kd ON kd.id = r.doc_id
  ORDER BY r.score DESC
  LIMIT p_limit;
$$;
