-- Per-client, per-agent data-source toggles.
--
-- The trainer can switch individual knowledge sources on/off for each AI agent
-- from the client header card (components/dashboard/AgentKnowledgeMap.tsx). The
-- AI service honors these when building an agent's tool set, so a disabled
-- source is genuinely withheld from the agent when it generates output.
--
-- Shape: { "<agent_id>": { "<source_id>": false, ... }, ... }
--   agent_id  ∈ planner | progress | nutrition | concierge | messaging | exercise
--   source_id ∈ profile | screening | inbody | workouts | program | progress
--               | memory | knowledge | food | exercises | web
-- Only OFF overrides are stored; a missing entry means the source is ON (default).
alter table clients
  add column if not exists agent_source_prefs jsonb not null default '{}'::jsonb;
