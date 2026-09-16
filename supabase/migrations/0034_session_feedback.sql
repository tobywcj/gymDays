-- ============================================================================
-- Per-session trainer feedback.
--
-- The trainer clicks a session on their calendar and leaves a note on how it
-- went (e.g. "form broke down on the last set, drop load 5%"). This feedback is
-- fed into the Programme "Last Session Analysis" so the AI weighs the trainer's
-- own observations, not just synced activity data.
--
-- Additive + nullable; existing readers/writers are unaffected. The sessions_*
-- RLS policies from 0030 already scope writes to the owning trainer.
-- ============================================================================

alter table sessions
  add column if not exists feedback    text,
  add column if not exists feedback_at timestamptz;
