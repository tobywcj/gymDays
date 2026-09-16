"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { type ExtraMetric, buildExtraMetrics, patchRow, slugify } from "@/lib/inbody";

export type DesignedBattery = {
  battery: Array<{ test: string; rationale: string; contraindication_check?: string }>;
  skipped: Array<{ test: string; reason: string }>;
};

type Severity = "none" | "mild" | "moderate" | "severe";
type Fms = { result: "pass" | "fail" | "compensation" | ""; notes: string };

type Props = {
  clientId: string;
  trainingBlocked: boolean;
  trainingBlockedReason: string | null;
  clearanceRequired: boolean;
  betaBlockers: boolean;
  designedBattery: DesignedBattery | null;
};

export default function FirstLessonCapture({
  clientId, trainingBlocked, trainingBlockedReason, clearanceRequired, betaBlockers, designedBattery,
}: Props) {
  const router = useRouter();
  const { t } = useI18n();
  const [step, setStep] = useState(1);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [bpBlock, setBpBlock] = useState(trainingBlocked);

  // Step 1 — Vitals + InBody
  const [vitals, setVitals] = useState({
    bp_systolic: "",
    bp_diastolic: "",
    resting_hr: "",
    weight_kg: "",
    bmi: "",
    body_fat_pct: "",
    fat_free_mass_kg: "",
    bmr_kcal: "",
    waist_hip_ratio: "",
    total_body_water_pct: "",
    notes: "",
  });
  // Machine-specific params (from OCR or added manually) beyond the typed fields.
  const [extra, setExtra] = useState<ExtraMetric[]>([]);
  const [machine, setMachine] = useState("");

  // Step 2 — Postural
  const [postural, setPostural] = useState({
    upper_crossed: "none" as Severity,
    upper_crossed_notes: "",
    lower_crossed: "none" as Severity,
    lower_crossed_notes: "",
    pronation_distortion: "none" as Severity,
    pronation_distortion_notes: "",
    scoliosis: "none" as Severity,
    scoliosis_notes: "",
  });

  // Step 3 — Functional Movement
  const [fms, setFms] = useState({
    overhead_squat: { result: "" as Fms["result"], notes: "" },
    hip_hinge: { result: "" as Fms["result"], notes: "" },
    single_leg_squat: { result: "" as Fms["result"], notes: "" },
    wall_angel: { result: "" as Fms["result"], notes: "" },
    summary: "",
  });

  // Step 4 — Fitness battery results
  const [results, setResults] = useState({
    bench_3rm_kg: "",
    squat_3rm_kg: "",
    handgrip_kg: "",
    plank_seconds: "",
    push_up_count: "",
    pull_up_count: "",
    crunch_count: "",
    sit_and_reach_cm: "",
    rockport_vo2: "",
    mile_15_time: "",
    chester_level: "",
    bess_errors: "",
    notes: "",
  });

  function bpDangerous(): boolean {
    const sys = parseInt(vitals.bp_systolic, 10);
    const dia = parseInt(vitals.bp_diastolic, 10);
    return (Number.isFinite(sys) && sys >= 200) || (Number.isFinite(dia) && dia >= 110);
  }

  async function saveStep1() {
    if (bpDangerous()) {
      setBpBlock(true);
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/first-lesson/${clientId}/vitals`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...toNumericPayload(vitals), extra_metrics: buildExtraMetrics(extra, machine) }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      setStep(2);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveSteps23() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/first-lesson/${clientId}/postural`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...postural, ...fms }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      setStep(4);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function saveStep4() {
    if (bpBlock || trainingBlocked) {
      setError(t("flc.blockedError"));
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/first-lesson/${clientId}/fitness`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          battery: designedBattery ?? null,
          results: toNumericPayload(results),
        }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      router.push(`/clients/${clientId}`);
      router.refresh();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="glass" style={{ borderRadius: 14, padding: 22, display: "flex", flexDirection: "column", gap: 18 }}>
      <StepHeader step={step} />

      {bpBlock && (
        <div data-testid="bp-block-banner" style={blockBanner}>
          🚫 <strong>{t("flc.blockedStrong")}</strong> {trainingBlockedReason ?? t("flc.blockedDefault")}
          {" "}{t("flc.blockedRefer")}
        </div>
      )}
      {clearanceRequired && !bpBlock && (
        <div style={warnBanner}>
          {t("flc.clearanceFlag")}
        </div>
      )}
      {betaBlockers && (
        <div style={infoBanner}>
          {t("flc.betaInfo")}
        </div>
      )}

      {step === 1 && (
        <StepVitals
          clientId={clientId}
          vitals={vitals as Record<string, string>}
          setVitals={setVitals as (v: Record<string, string>) => void}
          extra={extra}
          setExtra={setExtra}
          machine={machine}
          setMachine={setMachine}
        />
      )}
      {step === 2 && (
        <StepPostural postural={postural as Record<string, string>} setPostural={setPostural as (p: Record<string, string>) => void} />
      )}
      {step === 3 && (
        <StepFms fms={fms} setFms={setFms} />
      )}
      {step === 4 && (
        <StepFitness
          designedBattery={designedBattery}
          results={results as Record<string, string>}
          setResults={setResults as (r: Record<string, string>) => void}
          blocked={bpBlock || trainingBlocked}
        />
      )}

      {error && (
        <div data-testid="capture-error" style={{ color: "#f87171", fontSize: 12 }}>{error}</div>
      )}

      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <button
          type="button"
          onClick={() => setStep(Math.max(1, step - 1))}
          disabled={step === 1}
          style={ghostBtn(step === 1)}
        >
          {t("flc.back")}
        </button>
        {step === 1 && (
          <button
            type="button"
            data-testid="save-vitals"
            onClick={saveStep1}
            disabled={saving}
            style={primaryBtn(saving)}
          >
            {saving ? "…" : t("flc.saveVitals")}
          </button>
        )}
        {step === 2 && (
          <button type="button" onClick={() => setStep(3)} style={primaryBtn(false)}>
            {t("flc.nextFms")}
          </button>
        )}
        {step === 3 && (
          <button
            type="button"
            data-testid="save-postural"
            onClick={saveSteps23}
            disabled={saving}
            style={primaryBtn(saving)}
          >
            {saving ? "…" : t("flc.savePostural")}
          </button>
        )}
        {step === 4 && (
          <button
            type="button"
            data-testid="save-fitness"
            onClick={saveStep4}
            disabled={saving || bpBlock || trainingBlocked}
            style={primaryBtn(saving || bpBlock || trainingBlocked)}
          >
            {saving ? "…" : t("flc.saveFitness")}
          </button>
        )}
      </div>
    </div>
  );
}

function toNumericPayload(obj: Record<string, string>): Record<string, number | string | null> {
  const out: Record<string, number | string | null> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v === "") { out[k] = null; continue; }
    if (k === "notes" || k === "mile_15_time") { out[k] = v; continue; }
    const n = Number(v);
    out[k] = Number.isFinite(n) ? n : v;
  }
  return out;
}

function StepHeader({ step }: { step: number }) {
  const { t } = useI18n();
  const titles = [t("flc.step1"), t("flc.step2"), t("flc.step3"), t("flc.step4")];
  return (
    <div>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{titles[step - 1]}</div>
      <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
        {[1, 2, 3, 4].map((n) => (
          <div
            key={n}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: n <= step ? T.accent : T.border,
            }}
          />
        ))}
      </div>
    </div>
  );
}

type ScanState = "idle" | "scanning" | "done" | "error";

function StepVitals({
  clientId, vitals, setVitals, extra, setExtra, machine, setMachine,
}: {
  clientId: string;
  vitals: Record<string, string>;
  setVitals: (v: Record<string, string>) => void;
  extra: ExtraMetric[];
  setExtra: (e: ExtraMetric[]) => void;
  machine: string;
  setMachine: (m: string) => void;
}) {
  const { t } = useI18n();
  const [scan, setScan] = useState<ScanState>("idle");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const fields: Array<[string, string, string?]> = [
    ["bp_systolic", t("flc.v.bp_systolic"), "118"],
    ["bp_diastolic", t("flc.v.bp_diastolic"), "76"],
    ["resting_hr", t("flc.v.resting_hr"), "60"],
    ["weight_kg", t("flc.v.weight_kg"), "72.5"],
    ["bmi", t("flc.v.bmi"), "22.1"],
    ["body_fat_pct", t("flc.v.body_fat_pct"), "18.4"],
    ["fat_free_mass_kg", t("flc.v.fat_free_mass_kg"), "59.2"],
    ["bmr_kcal", t("flc.v.bmr_kcal"), "1620"],
    ["waist_hip_ratio", t("flc.v.waist_hip_ratio"), "0.82"],
    ["total_body_water_pct", t("flc.v.total_body_water_pct"), "58.0"],
  ];
  const mappedKeys = new Set(fields.map(([k]) => k));

  async function runOcr(file: File) {
    setScan("scanning");
    setScanMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/first-lesson/${clientId}/inbody-ocr`, { method: "POST", body: fd });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `${r.status}`);

      // Autofill the typed fields; keep anything the trainer already typed.
      const mapped = (j.mapped ?? {}) as Record<string, number | null>;
      const merged = { ...vitals };
      let filled = 0;
      for (const k of Object.keys(mapped)) {
        if (mappedKeys.has(k) && mapped[k] !== null && mapped[k] !== undefined) {
          merged[k] = String(mapped[k]);
          filled += 1;
        }
      }
      setVitals(merged);

      // Merge extra rows (dedupe by key against what's already there).
      if (j.machine && !machine.trim()) setMachine(String(j.machine));
      const existing = new Set(extra.map((m) => m.key));
      const rows: ExtraMetric[] = [];
      for (const e of (j.extra ?? []) as Array<{ key: string; label?: string; value?: number | null; unit?: string }>) {
        if (!e.key || existing.has(e.key) || mappedKeys.has(e.key)) continue;
        existing.add(e.key);
        rows.push({
          key: e.key,
          label: e.label ?? e.key,
          value: e.value == null ? "" : String(e.value),
          unit: e.unit ?? "",
        });
        filled += 1;
      }
      if (rows.length) setExtra([...extra, ...rows]);

      setScan("done");
      setScanMsg(t("flc.ocr.done").replace("{n}", String(filled)));
    } catch (err) {
      setScan("error");
      setScanMsg((err as Error).message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {/* Photo OCR — autofill from an InBody / BIA printout */}
      <div style={ocrCard}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          data-testid="inbody-photo"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void runOcr(f);
            e.target.value = "";
          }}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 18 }}>📷</span>
          <div style={{ flex: 1, minWidth: 160 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: T.text }}>{t("flc.ocr.title")}</div>
            <div style={{ fontSize: 10, color: T.muted, marginTop: 2 }}>{t("flc.ocr.hint")}</div>
          </div>
          <button
            type="button"
            data-testid="inbody-scan-btn"
            disabled={scan === "scanning"}
            onClick={() => fileRef.current?.click()}
            style={primaryBtn(scan === "scanning")}
          >
            {scan === "scanning" ? t("flc.ocr.scanning") : t("flc.ocr.upload")}
          </button>
        </div>
        {scanMsg && (
          <div style={{ fontSize: 11, marginTop: 8, color: scan === "error" ? "#fab9a9" : "#a7cf9a" }}>
            {scan === "error" ? `⚠ ${scanMsg}` : `✓ ${scanMsg}`}
          </div>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12 }}>
        {fields.map(([k, label, placeholder]) => (
          <Field key={k} label={label}>
            <input
              type="number"
              step="0.01"
              data-testid={`vitals-${k}`}
              value={vitals[k]}
              onChange={(e) => setVitals({ ...vitals, [k]: e.target.value })}
              placeholder={placeholder}
              style={inputStyle}
            />
          </Field>
        ))}
      </div>

      {/* Machine-specific / extra params (populated by OCR, editable, extendable) */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase" }}>
            {t("flc.extra.title")}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <input
              data-testid="inbody-machine"
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
              placeholder={t("flc.extra.machine")}
              style={{ ...inputStyle, width: 150, fontSize: 11 }}
            />
            <button
              type="button"
              data-testid="extra-add"
              onClick={() => setExtra([...extra, { key: "", label: "", value: "", unit: "" }])}
              style={ghostBtn(false)}
            >
              {t("flc.extra.add")}
            </button>
          </div>
        </div>

        {extra.length === 0 ? (
          <div style={{ fontSize: 10, color: T.muted }}>{t("flc.extra.empty")}</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {extra.map((m, i) => (
              <div
                key={i}
                data-testid={`extra-row-${i}`}
                style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 28px", gap: 6, alignItems: "center" }}
              >
                <input
                  value={m.label}
                  onChange={(e) => setExtra(patchRow(extra, i, { label: e.target.value, key: m.key || slugify(e.target.value) }))}
                  placeholder={t("flc.extra.name")}
                  style={{ ...inputStyle, fontSize: 11 }}
                />
                <input
                  type="number"
                  step="0.01"
                  value={m.value}
                  onChange={(e) => setExtra(patchRow(extra, i, { value: e.target.value }))}
                  placeholder={t("flc.extra.value")}
                  style={{ ...inputStyle, fontSize: 11 }}
                />
                <input
                  value={m.unit}
                  onChange={(e) => setExtra(patchRow(extra, i, { unit: e.target.value }))}
                  placeholder={t("flc.extra.unit")}
                  style={{ ...inputStyle, fontSize: 11 }}
                />
                <button
                  type="button"
                  aria-label="remove"
                  data-testid={`extra-remove-${i}`}
                  onClick={() => setExtra(extra.filter((_, j) => j !== i))}
                  style={{ ...ghostBtn(false), padding: "6px 0", textAlign: "center" }}
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <Field label={t("flc.notes")} wide>
        <textarea
          rows={2}
          data-testid="vitals-notes"
          value={vitals.notes}
          onChange={(e) => setVitals({ ...vitals, notes: e.target.value })}
          style={inputStyle}
        />
      </Field>
    </div>
  );
}

const ocrCard: React.CSSProperties = {
  padding: "12px 14px",
  borderRadius: 10,
  background: "rgba(98,132,88,0.10)",
  border: "1px dashed rgba(98,132,88,0.5)",
};

function StepPostural({
  postural, setPostural,
}: {
  postural: Record<string, string>;
  setPostural: (p: Record<string, string>) => void;
}) {
  const { t } = useI18n();
  const syndromes: Array<[string, string]> = [
    ["upper_crossed", t("flc.p.upper_crossed")],
    ["lower_crossed", t("flc.p.lower_crossed")],
    ["pronation_distortion", t("flc.p.pronation_distortion")],
    ["scoliosis", t("flc.p.scoliosis")],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {syndromes.map(([k, label]) => (
        <div key={k} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
          <SeverityPicker
            testId={k}
            value={postural[k]}
            onChange={(v) => setPostural({ ...postural, [k]: v })}
          />
          <input
            data-testid={`${k}-notes`}
            placeholder={t("flc.notesPlaceholder")}
            value={postural[`${k}_notes`] ?? ""}
            onChange={(e) => setPostural({ ...postural, [`${k}_notes`]: e.target.value })}
            style={inputStyle}
          />
        </div>
      ))}
    </div>
  );
}

function StepFms({
  fms, setFms,
}: {
  fms: {
    overhead_squat: Fms; hip_hinge: Fms; single_leg_squat: Fms; wall_angel: Fms; summary: string;
  };
  setFms: (f: typeof fms) => void;
}) {
  const { t } = useI18n();
  const movements: Array<[keyof typeof fms, string]> = [
    ["overhead_squat", t("flc.m.overhead_squat")],
    ["hip_hinge", t("flc.m.hip_hinge")],
    ["single_leg_squat", t("flc.m.single_leg_squat")],
    ["wall_angel", t("flc.m.wall_angel")],
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {movements.map(([key, label]) => {
        const item = fms[key] as Fms;
        return (
          <div key={String(key)} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {(["pass", "compensation", "fail"] as const).map((r) => (
                <button
                  key={r}
                  type="button"
                  data-testid={`fms-${String(key)}-${r}`}
                  onClick={() => setFms({ ...fms, [key]: { ...item, result: r } })}
                  style={pillBtn(item.result === r, r === "pass" ? "#628458" : r === "fail" ? "#c45640" : "#c49452")}
                >
                  {t(`flc.res.${r}`)}
                </button>
              ))}
            </div>
            <input
              data-testid={`fms-${String(key)}-notes`}
              placeholder={t("flc.compNotes")}
              value={item.notes}
              onChange={(e) => setFms({ ...fms, [key]: { ...item, notes: e.target.value } })}
              style={inputStyle}
            />
          </div>
        );
      })}
      <Field label={t("flc.overallSummary")}>
        <textarea
          rows={2}
          data-testid="fms-summary"
          value={fms.summary}
          onChange={(e) => setFms({ ...fms, summary: e.target.value })}
          style={inputStyle}
        />
      </Field>
    </div>
  );
}

function StepFitness({
  designedBattery, results, setResults, blocked,
}: {
  designedBattery: DesignedBattery | null;
  results: Record<string, string>;
  setResults: (r: Record<string, string>) => void;
  blocked: boolean;
}) {
  const { t } = useI18n();
  const allFields: Record<string, string> = {
    bench_3rm_kg: t("flc.f.bench_3rm_kg"),
    squat_3rm_kg: t("flc.f.squat_3rm_kg"),
    handgrip_kg: t("flc.f.handgrip_kg"),
    plank_seconds: t("flc.f.plank_seconds"),
    push_up_count: t("flc.f.push_up_count"),
    pull_up_count: t("flc.f.pull_up_count"),
    crunch_count: t("flc.f.crunch_count"),
    sit_and_reach_cm: t("flc.f.sit_and_reach_cm"),
    rockport_vo2: t("flc.f.rockport_vo2"),
    mile_15_time: t("flc.f.mile_15_time"),
    chester_level: t("flc.f.chester_level"),
    bess_errors: t("flc.f.bess_errors"),
  };

  // Default to showing the planner-designed battery when present; fall back to all fields.
  const designedKeys: string[] | null = designedBattery?.battery
    ? designedBattery.battery.map((b) => testToFieldKey(b.test)).filter((k): k is string => !!k)
    : null;
  const skippedKeys = new Set(
    (designedBattery?.skipped ?? [])
      .map((s) => testToFieldKey(s.test))
      .filter((k): k is string => !!k),
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {designedBattery && (
        <div data-testid="designed-battery" style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.mutedMid }}>
          <div style={{ fontWeight: 700, color: T.text, fontSize: 11, letterSpacing: "0.1em", textTransform: "uppercase" }}>
            {t("flc.plannerBattery")}
          </div>
          {designedBattery.battery.map((b, i) => (
            <div key={i}>
              <strong style={{ color: T.text }}>{b.test}</strong> — {b.rationale}
            </div>
          ))}
          {designedBattery.skipped.length > 0 && (
            <div style={{ marginTop: 4, color: "#fab9a9" }}>
              {t("flc.skipped")} {designedBattery.skipped.map((s) => `${s.test} (${s.reason})`).join("; ")}
            </div>
          )}
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, opacity: blocked ? 0.5 : 1, pointerEvents: blocked ? "none" : "auto" }}>
        {Object.entries(allFields).map(([k, label]) => {
          const skipped = skippedKeys.has(k);
          const highlighted = designedKeys?.includes(k) ?? true;
          return (
            <Field key={k} label={label}>
              <input
                type={k === "mile_15_time" ? "text" : "number"}
                step="0.01"
                data-testid={`fitness-${k}`}
                value={results[k]}
                disabled={skipped}
                onChange={(e) => setResults({ ...results, [k]: e.target.value })}
                placeholder={skipped ? t("flc.skippedPh") : undefined}
                style={{ ...inputStyle, opacity: highlighted ? 1 : 0.5 }}
              />
            </Field>
          );
        })}
      </div>

      <Field label={t("flc.notes")} wide>
        <textarea
          rows={2}
          data-testid="fitness-notes"
          value={results.notes}
          onChange={(e) => setResults({ ...results, notes: e.target.value })}
          style={inputStyle}
        />
      </Field>
    </div>
  );
}

function testToFieldKey(test: string): string | null {
  const t = test.toLowerCase();
  if (t.includes("bench")) return "bench_3rm_kg";
  if (t.includes("squat") && t.includes("3rm")) return "squat_3rm_kg";
  if (t.includes("handgrip")) return "handgrip_kg";
  if (t.includes("plank")) return "plank_seconds";
  if (t.includes("push")) return "push_up_count";
  if (t.includes("pull")) return "pull_up_count";
  if (t.includes("crunch")) return "crunch_count";
  if (t.includes("sit") && t.includes("reach")) return "sit_and_reach_cm";
  if (t.includes("rockport")) return "rockport_vo2";
  if (t.includes("1.5") || t.includes("mile")) return "mile_15_time";
  if (t.includes("chester")) return "chester_level";
  if (t.includes("bess")) return "bess_errors";
  return null;
}

function SeverityPicker({
  value, onChange, testId,
}: {
  value: string;
  onChange: (v: Severity) => void;
  testId: string;
}) {
  const { t } = useI18n();
  const opts: Severity[] = ["none", "mild", "moderate", "severe"];
  return (
    <div style={{ display: "flex", gap: 6 }}>
      {opts.map((o) => (
        <button
          key={o}
          type="button"
          data-testid={`${testId}-${o}`}
          onClick={() => onChange(o)}
          style={pillBtn(value === o, o === "none" ? "#628458" : o === "severe" ? "#c45640" : "#c49452")}
        >
          {t(`flc.sev.${o}`)}
        </button>
      ))}
    </div>
  );
}

// ─── primitives ────────────────────────────────────────────────────────────
const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "8px 10px",
  color: T.text,
  fontSize: 12,
  outline: "none",
  width: "100%",
};

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <label style={{
      display: "flex", flexDirection: "column", gap: 4,
      fontSize: 10, color: T.muted,
      gridColumn: wide ? "1 / -1" : undefined,
    }}>
      {label}
      {children}
    </label>
  );
}

function pillBtn(active: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "5px 12px",
    borderRadius: 99,
    border: `1px solid ${active ? color : T.border}`,
    background: active ? color : "transparent",
    color: active ? "#fffdf6" : T.mutedMid,
    cursor: "pointer",
    fontWeight: 600,
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "linear-gradient(135deg, rgba(98,132,88,0.95) 0%, rgba(58,82,52,0.95) 100%)",
    border: "1px solid rgba(255,252,245,0.25)",
    borderRadius: 99,
    padding: "8px 18px",
    color: "#fffdf6",
    fontSize: 12,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${T.border}`,
    borderRadius: 99,
    padding: "8px 14px",
    color: T.mutedMid,
    fontSize: 11,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}

const blockBanner: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(196, 86, 64, 0.22)",
  border: "1px solid rgba(196, 86, 64, 0.55)",
  color: "#fde2da",
  fontSize: 11,
  lineHeight: 1.5,
};

const warnBanner: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(196, 148, 82, 0.18)",
  border: "1px solid rgba(196, 148, 82, 0.45)",
  color: "#fbe0b8",
  fontSize: 11,
  lineHeight: 1.5,
};

const infoBanner: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  background: "rgba(98, 132, 88, 0.18)",
  border: "1px solid rgba(98, 132, 88, 0.45)",
  color: "#d4e7c8",
  fontSize: 11,
  lineHeight: 1.5,
};
