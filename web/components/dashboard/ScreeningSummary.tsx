"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import AlertActionForm from "./AlertActionForm";

export type ScreeningRow = {
  id: string;
  parq: Record<string, unknown> | null;
  medical_history: Record<string, unknown> | null;
  cvd_risk: Record<string, unknown> | null;
  parq_yes_count: number | null;
  medical_clearance_required: boolean | null;
  cvd_risk_factor_count: number | null;
  submitted_at: string;
};

export type ClearanceState = {
  clearance_received_at: string | null;
  clearance_note: string | null;
};

// Agent verdict from POST /api/client/[id]/readiness (ephemeral — always fresh
// against the current injury status + chronic/meds the trainer just edited).
type Readiness = {
  verdict: "ready" | "alert";
  rationale: string | null;
  flags: { label: string; value: string }[];
  checked_at: string | null;
};

const CHRONIC_KEYS = ["hypertension", "diabetes", "asthma", "anemia"] as const;

type TFn = (key: string) => string;

const PARQ_FIELDS = [
  "heart_condition",
  "chest_pain_activity",
  "chest_pain_rest",
  "dizziness",
  "bone_joint",
  "blood_pressure_med",
  "other_reason",
] as const;

type Tone = "ok" | "warn" | "bad";
const TONE: Record<Tone, { fg: string; bg: string; bd: string }> = {
  ok:   { fg: "#cfe6c0", bg: "rgba(98,132,88,0.16)",  bd: "rgba(127,181,110,0.40)" },
  warn: { fg: "#f0d6a4", bg: "rgba(196,148,82,0.16)", bd: "rgba(196,148,82,0.45)" },
  bad:  { fg: "#fbcabe", bg: "rgba(196,86,64,0.18)",  bd: "rgba(196,86,64,0.50)" },
};

export default function ScreeningSummary({
  screening, clearance, clientId, injuryStatus,
}: {
  screening: ScreeningRow | null;
  clearance: ClearanceState;
  clientId: string;
  // Live official injury status (clients.injury_history) — the SAME source the
  // Injury Status card shows, so the "previous injuries" tile never drifts from it.
  injuryStatus: string | null;
}) {
  // Translation comes from useI18n() (client context) so the card flips
  // instantly with the language toggle — no server round-trip.
  const { t } = useI18n();
  const router = useRouter();

  // medical_history is read here (before any early return) so the editable-state
  // hooks below can seed from it without breaking the Rules of Hooks.
  const med = (screening?.medical_history ?? {}) as {
    previous_injuries?: string[];
    medications?: string[];
    beta_blockers?: boolean;
    chronic?: Record<string, boolean>;
    notes?: string;
  };

  // Manually-editable health flags (chronic conditions + medications + beta-blockers).
  const [editHealth, setEditHealth] = useState(false);
  const [chronicEdit, setChronicEdit] = useState<Record<string, boolean>>(seedChronic(med.chronic));
  const [medsText, setMedsText] = useState((med.medications ?? []).join("\n"));
  const [betaEdit, setBetaEdit] = useState(!!med.beta_blockers);
  const [savingHealth, setSavingHealth] = useState(false);
  const [healthErr, setHealthErr] = useState<string | null>(null);

  // Agent readiness verdict (run on demand).
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [runningReadiness, setRunningReadiness] = useState(false);
  const [readinessErr, setReadinessErr] = useState<string | null>(null);

  function openHealthEdit() {
    // Re-seed from the freshest props each time (state persists across refreshes).
    setChronicEdit(seedChronic(med.chronic));
    setMedsText((med.medications ?? []).join("\n"));
    setBetaEdit(!!med.beta_blockers);
    setHealthErr(null);
    setEditHealth(true);
  }

  async function saveHealth() {
    setSavingHealth(true);
    setHealthErr(null);
    try {
      const r = await fetch(`/api/clients/${clientId}/screening`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chronic: chronicEdit,
          medications: medsText.split("\n").map((s) => s.trim()).filter(Boolean),
          beta_blockers: betaEdit,
        }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setEditHealth(false);
      // A manual edit invalidates any prior verdict — force a re-run.
      setReadiness(null);
      router.refresh();
    } catch (e) {
      setHealthErr((e as Error).message);
    } finally {
      setSavingHealth(false);
    }
  }

  async function runReadiness() {
    setRunningReadiness(true);
    setReadinessErr(null);
    try {
      const r = await fetch(`/api/client/${clientId}/readiness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data?.error || "error");
      setReadiness(data as Readiness);
    } catch (e) {
      setReadinessErr((e as Error).message);
    } finally {
      setRunningReadiness(false);
    }
  }

  if (!screening) {
    return (
      <div className="glass" style={card}>
        <SectionLabel>🩺 {t("scr.title")}</SectionLabel>
        <div style={{ fontSize: 12, color: T.muted, marginTop: 8 }}>{t("scr.none")}</div>
      </div>
    );
  }

  const parq = (screening.parq ?? {}) as Record<string, boolean | string>;
  const cvd = (screening.cvd_risk ?? {}) as {
    age?: number;
    sex?: "m" | "f";
    family_history?: boolean;
    smoking?: boolean;
    inactivity?: boolean;
    obesity?: boolean;
  };

  const parqYesItems = PARQ_FIELDS.filter((k) => parq[k] === true).map((k) => t(`parq.${k}`));
  const parqCount = parqYesItems.length;
  const cvdCount = screening.cvd_risk_factor_count ?? 0;
  const received = !!clearance.clearance_received_at;
  const required = !!screening.medical_clearance_required;

  const chronicYes = chronicList(med.chronic, t);
  const injuryItems = (injuryStatus ?? "")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
  const cvdFactors = [
    cvd.family_history && t("scr.familyHistory"),
    cvd.smoking && t("scr.smoking"),
    cvd.inactivity && t("scr.inactivity"),
    cvd.obesity && t("scr.obesity"),
    cvd.age && cvd.sex && ((cvd.sex === "m" && cvd.age >= 45) || (cvd.sex === "f" && cvd.age >= 55)) && `${t("scr.age")} ${cvd.age}`,
  ].filter(Boolean) as string[];

  // Overall status pill. Once the AI readiness check has run it OWNS the pill
  // (that's the whole-picture verdict); before then it falls back to the
  // deterministic PAR-Q / clearance gate.
  const pill: { tone: Tone; text: string } = readiness
    ? readiness.verdict === "ready"
      ? { tone: "ok", text: t("scr.verdictReady") }
      : { tone: "bad", text: t("scr.verdictAlert") }
    : received
      ? { tone: "ok", text: t("scr.cleared") }
      : required
        ? { tone: "bad", text: t("scr.clearanceRequired") }
        : { tone: "ok", text: t("scr.okToTrain") };

  const cvdTone: Tone = cvdCount >= 3 ? "bad" : cvdCount === 2 ? "warn" : "ok";

  return (
    <div className="glass" style={card} data-testid="screening-summary">
      {/* Header + overall status */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <SectionLabel>🩺 {t("scr.title")}</SectionLabel>
          <div style={{ fontSize: 10, color: T.muted, marginTop: 4 }}>
            {t("scr.submitted")} {new Date(screening.submitted_at).toLocaleDateString()}
          </div>
        </div>
        <Pill tone={pill.tone}>{readiness ? `🤖 ${pill.text}` : pill.text}</Pill>
      </div>

      {/* At-a-glance metric strip */}
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Stat
          label={t("scr.parqShort")}
          value={parqCount === 0 ? t("scr.allNo") : `${parqCount} ${t("scr.flagged")}`}
          tone={parqCount === 0 ? "ok" : "bad"}
        />
        <Stat label={t("scr.cvdShort")} value={`${cvdCount} ${t("scr.ofFive")}`} tone={cvdTone} />
        <Stat
          label={t("scr.clearanceShort")}
          value={received ? t("scr.cleared") : required ? t("scr.required") : t("scr.notRequired")}
          tone={received ? "ok" : required ? "bad" : "ok"}
        />
      </div>

      {/* Clearance action banners */}
      {required && !received && (
        <div data-testid="clearance-flag" style={banner("bad")}>
          ⚠ <strong>{t("scr.clearanceRequired")}</strong> {t("scr.clearedPre")} {screening.parq_yes_count} {t("scr.clearedPost")}
          <AlertActionForm
            clientId={clientId}
            endpoint="clearance"
            buttonLabel={t("scr.markClearance")}
            successLabel={t("scr.recordClearance")}
            placeholder={t("scr.clearancePlaceholder")}
            testId="record-clearance"
          />
        </div>
      )}

      {received && (
        <div data-testid="clearance-received" style={banner("ok")}>
          ✓ <strong>{t("scr.clearanceRecorded")}</strong> {t("scr.on")}{" "}
          {new Date(clearance.clearance_received_at!).toLocaleDateString()}.
          {clearance.clearance_note && (
            <div style={{ marginTop: 4, color: T.mutedMid }}>{t("scr.note")} {clearance.clearance_note}</div>
          )}
        </div>
      )}

      {/* ── Agent readiness verdict ─────────────────────────────────── */}
      <div style={{ marginTop: 14, padding: "12px 14px", borderRadius: 12, background: "rgba(0,0,0,0.16)", border: `1px solid ${T.border}` }} data-testid="readiness">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <SectionLabel>🤖 {t("scr.readinessTitle")}</SectionLabel>
          <button onClick={runReadiness} disabled={runningReadiness} data-testid="run-readiness"
            style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: "rgba(255,252,245,0.12)", border: "1px solid rgba(255,252,245,0.35)", color: "#fffdf6", fontWeight: 600, cursor: runningReadiness ? "default" : "pointer", opacity: runningReadiness ? 0.6 : 1, whiteSpace: "nowrap" }}>
            {runningReadiness ? `⋯ ${t("scr.analyzing")}` : readiness ? `↻ ${t("scr.rerun")}` : `▶ ${t("scr.runReadiness")}`}
          </button>
        </div>
        {!readiness && !runningReadiness && !readinessErr && (
          <div style={{ fontSize: 11, color: T.muted, marginTop: 6 }}>{t("scr.readinessHint")}</div>
        )}
        {readinessErr && <div style={{ fontSize: 10.5, color: "#f87171", marginTop: 6, fontFamily: T.font.mono }}>{readinessErr}</div>}
        {readiness && (
          <div style={{ ...banner(readiness.verdict === "ready" ? "ok" : "bad"), marginTop: 10 }} data-testid="readiness-verdict">
            <div style={{ fontSize: 13, fontWeight: 700, letterSpacing: "0.02em" }}>
              {readiness.verdict === "ready" ? `✅ ${t("scr.verdictReady")}` : `⚠ ${t("scr.verdictAlert")}`}
            </div>
            {readiness.rationale && (
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {readiness.rationale.split("\n").map((l) => l.trim()).filter(Boolean).map((line, i) => (
                  <div key={i} style={{ fontSize: 11.5, lineHeight: 1.5 }}>{line}</div>
                ))}
              </div>
            )}
            {readiness.flags && readiness.flags.length > 0 && (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {readiness.flags.map((f, i) => (
                  <span key={i} style={{ fontSize: 10, padding: "3px 9px", borderRadius: 99, background: "rgba(0,0,0,0.25)", border: `1px solid ${T.border}`, color: T.mutedMid }}>
                    <strong style={{ color: T.text }}>{f.label}</strong> {f.value}
                  </span>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Editable health-flags toolbar ───────────────────────────── */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 14, gap: 8 }}>
        <SectionLabel>{t("scr.healthDetails")}</SectionLabel>
        {!editHealth ? (
          <button onClick={openHealthEdit} data-testid="health-edit"
            style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: "rgba(255,252,245,0.12)", border: "1px solid rgba(255,252,245,0.35)", color: "#fffdf6", fontWeight: 600, cursor: "pointer" }}>
            ✎ {t("scr.editHealth")}
          </button>
        ) : (
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={saveHealth} disabled={savingHealth} data-testid="health-save"
              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: "rgba(127,181,110,0.35)", border: "1px solid rgba(127,181,110,0.7)", color: "#fffdf6", fontWeight: 600, cursor: savingHealth ? "default" : "pointer", opacity: savingHealth ? 0.6 : 1 }}>
              {savingHealth ? "…" : t("injury.save")}
            </button>
            <button onClick={() => setEditHealth(false)} disabled={savingHealth}
              style={{ fontSize: 11, padding: "5px 12px", borderRadius: 99, background: "transparent", border: `1px solid ${T.border}`, color: T.mutedMid, cursor: "pointer" }}>
              {t("common.cancel")}
            </button>
          </div>
        )}
      </div>
      {healthErr && <div style={{ fontSize: 10, color: "#f87171", marginTop: 4, fontFamily: T.font.mono }}>{healthErr}</div>}

      {/* Detail tiles — only render the ones with content (plus the always-on basics) */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 10, marginTop: 10 }}>
        <Tile icon="🧬" label={t("scr.chronic")}>
          {editHealth ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }} data-testid="chronic-edit">
              {CHRONIC_KEYS.map((k) => (
                <label key={k} style={checkRow}>
                  <input type="checkbox" checked={!!chronicEdit[k]}
                    onChange={(e) => setChronicEdit({ ...chronicEdit, [k]: e.target.checked })} />
                  {t(`chronic.${k}`)}
                </label>
              ))}
            </div>
          ) : chronicYes.length === 0 ? (
            <Muted>{t("scr.none2")}</Muted>
          ) : (
            <RiskList items={chronicYes} />
          )}
        </Tile>

        <Tile icon="💊" label={t("scr.medications")}>
          {editHealth ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }} data-testid="meds-edit">
              <textarea rows={3} value={medsText} onChange={(e) => setMedsText(e.target.value)}
                placeholder={t("scr.medsPlaceholder")} style={editTextarea} />
              <label style={checkRow}>
                <input type="checkbox" checked={betaEdit} onChange={(e) => setBetaEdit(e.target.checked)} />
                {t("scr.betaBlockersLabel")}
              </label>
            </div>
          ) : (
            <>
              {med.medications && med.medications.length > 0
                ? <List items={med.medications} highlight={med.beta_blockers ? /beta|propranolol|atenolol|metoprolol|bisoprolol|carvedilol/i : undefined} />
                : <Muted>{t("scr.noneReported")}</Muted>}
              {med.beta_blockers && (
                <div style={{ fontSize: 10, color: "#fab9a9", marginTop: 4 }}>{t("scr.betaBlockers")}</div>
              )}
            </>
          )}
        </Tile>

        <Tile icon="🩹" label={t("scr.prevInjuries")}>
          {injuryItems.length > 0
            ? <List items={injuryItems} />
            : <Muted>{t("scr.noneReported")}</Muted>}
          <div style={{ fontSize: 9, color: T.muted, marginTop: 5 }}>↔ {t("scr.syncedInjury")}</div>
        </Tile>

        {parqCount > 0 && (
          <Tile icon="❤️" label={t("scr.parqFlagged")}>
            <RiskList items={parqYesItems} />
          </Tile>
        )}

        {cvdFactors.length > 0 && (
          <Tile icon="🫀" label={t("scr.cvdFactors")}>
            <span style={{ fontSize: 12, color: T.mutedMid }}>{cvdFactors.join(" · ")}</span>
          </Tile>
        )}

        {med.notes && (
          <Tile icon="📝" label={t("scr.clientNotes")}>
            <span style={{ fontSize: 11.5, color: T.mutedMid }}>{med.notes}</span>
          </Tile>
        )}
      </div>
    </div>
  );
}

function seedChronic(chronic: Record<string, boolean> | undefined): Record<string, boolean> {
  const c = chronic ?? {};
  return {
    hypertension: !!c.hypertension,
    diabetes: !!c.diabetes,
    asthma: !!c.asthma,
    anemia: !!c.anemia,
  };
}

function chronicList(chronic: Record<string, boolean> | undefined, t: TFn): string[] {
  if (!chronic) return [];
  return CHRONIC_KEYS.filter((k) => chronic[k]).map((k) => t(`chronic.${k}`));
}

// ── Presentational helpers ───────────────────────────────────────────────────

const card: React.CSSProperties = { borderRadius: 16, padding: "18px 22px" };

const checkRow: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: T.text, cursor: "pointer",
};

const editTextarea: React.CSSProperties = {
  width: "100%", boxSizing: "border-box", resize: "vertical",
  background: "rgba(0,0,0,0.35)", border: `1px solid ${T.border}`, borderRadius: 8,
  padding: "7px 9px", color: T.text, fontSize: 12, fontFamily: T.font.sans, outline: "none",
};

function banner(tone: Tone): React.CSSProperties {
  const c = TONE[tone];
  return {
    marginTop: 12, padding: "10px 12px", borderRadius: 10,
    background: c.bg, border: `1px solid ${c.bd}`, color: c.fg,
    fontSize: 11, lineHeight: 1.5,
  };
}

function Pill({ tone, children }: { tone: Tone; children: React.ReactNode }) {
  const c = TONE[tone];
  return (
    <span style={{
      flexShrink: 0, fontSize: 11, fontWeight: 700, padding: "4px 11px", borderRadius: 99,
      background: c.bg, border: `1px solid ${c.bd}`, color: c.fg, whiteSpace: "nowrap",
    }}>
      {children}
    </span>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: Tone }) {
  const c = TONE[tone];
  return (
    <div style={{ flex: "1 1 0", minWidth: 92, padding: "10px 12px", borderRadius: 12, background: c.bg, border: `1px solid ${c.bd}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 700, color: c.fg, marginTop: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{value}</div>
    </div>
  );
}

function Tile({ icon, label, children }: { icon: string; label: string; children: React.ReactNode }) {
  return (
    <div style={{ padding: "10px 12px", borderRadius: 12, background: "rgba(0,0,0,0.16)", border: `1px solid ${T.border}` }}>
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, marginBottom: 6 }}>
        {icon} {label}
      </div>
      <div style={{ fontSize: 12, color: T.text }}>{children}</div>
    </div>
  );
}

function Muted({ children }: { children: React.ReactNode }) {
  return <span style={{ color: T.muted }}>{children}</span>;
}

function List({ items, highlight }: { items: string[]; highlight?: RegExp }) {
  return (
    <ul style={ul}>
      {items.map((m, i) => (
        <li key={i} style={{ color: highlight && highlight.test(m) ? "#fab9a9" : undefined }}>{m}</li>
      ))}
    </ul>
  );
}

function RiskList({ items }: { items: string[] }) {
  return (
    <ul style={ul}>
      {items.map((m) => <li key={m} style={{ color: "#fab9a9" }}>{m}</li>)}
    </ul>
  );
}

const ul: React.CSSProperties = { margin: 0, paddingLeft: 16, fontSize: 12, color: T.mutedMid, lineHeight: 1.5 };

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: T.muted }}>
      {children}
    </div>
  );
}
