-- ============================================================================
-- Let the trainer CLOSE an injury: mark a trail entry resolved so it stops
-- flagging. Resolved entries are excluded from the caveat-badge + LLM injury
-- aggregation (the trainer's explicit override of the otherwise-conservative
-- "flag every past injury" behaviour). The row stays in the trail for the audit
-- record — resolving is reversible (reopen sets resolved_at back to null).
-- ============================================================================

alter table client_injury_log
  add column if not exists resolved_at timestamptz;
