-- Enable Supabase Realtime for the activities table so the chart updates
-- automatically when new workouts arrive via webhook or backfill.
alter publication supabase_realtime add table activities;
