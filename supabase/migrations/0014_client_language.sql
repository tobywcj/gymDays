-- ============================================================================
-- Per-client language preference. Drives the output language for every
-- agent-generated text (concierge replies, progress reports, programs,
-- nutrition advice, messaging flows, HR insights).
-- ============================================================================

alter table clients
  add column if not exists language text not null default 'en'
    check (language in ('en', 'zh'));
