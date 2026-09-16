-- ============================================================================
-- Flip the per-client language default to Traditional Chinese.
-- New clients (manual add or onboarding without an explicit choice) now get
-- 'zh' as their agent-output language. Existing rows keep their stored value.
-- ============================================================================

alter table clients
  alter column language set default 'zh';
