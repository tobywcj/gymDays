-- ─── InBody OCR: flexible bucket for machine-specific body-composition params ─
-- The 7 typed InBody columns on client_health_metrics only cover the panel
-- common to every device. InBody 270/370/570/770/970 (and BIA scales) each
-- print extra parameters — segmental lean/fat mass, visceral fat level,
-- skeletal muscle mass, protein, minerals, phase angle, InBody score, etc.
-- Rather than add a column per device, we stash everything the OCR (or the
-- trainer, manually) captures beyond the typed columns into one jsonb bag.
--
-- Shape: an object keyed by snake_case metric key, each value describing the
-- reading, plus optional reserved metadata keys prefixed with "_":
--   {
--     "_machine": "InBody 570",
--     "skeletal_muscle_mass_kg": { "label": "Skeletal Muscle Mass", "value": 33.5, "unit": "kg" },
--     "visceral_fat_level":      { "label": "Visceral Fat Level",   "value": 8,    "unit": "" }
--   }
alter table client_health_metrics
  add column if not exists extra_metrics jsonb not null default '{}'::jsonb;

comment on column client_health_metrics.extra_metrics is
  'Machine-specific / manually-added body-composition params beyond the typed InBody columns. Object keyed by snake_case metric key -> { label, value, unit }; reserved "_"-prefixed keys hold metadata (e.g. "_machine").';
