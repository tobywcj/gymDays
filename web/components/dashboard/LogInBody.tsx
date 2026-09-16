"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import {
  type ExtraMetric,
  type InbodyOcr,
  INBODY_FIELDS,
  buildExtraMetrics,
  mergeOcr,
  patchRow,
  slugify,
} from "@/lib/inbody";

type ScanState = "idle" | "scanning" | "done" | "error";

const EMPTY: Record<string, string> = Object.fromEntries(INBODY_FIELDS.map(([k]) => [k, ""]));
const MAPPED_KEYS = new Set(INBODY_FIELDS.map(([k]) => k));

// Standalone "log a reading" form — the same OCR + manual + extras capture as
// intake, usable any time from the body-composition panel.
export default function LogInBody({ clientId, onDone }: { clientId: string; onDone: () => void }) {
  const { t } = useI18n();
  const router = useRouter();
  const [values, setValues] = useState<Record<string, string>>({ ...EMPTY });
  const [extra, setExtra] = useState<ExtraMetric[]>([]);
  const [machine, setMachine] = useState("");
  const [notes, setNotes] = useState("");
  const [scan, setScan] = useState<ScanState>("idle");
  const [scanMsg, setScanMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function runOcr(file: File) {
    setScan("scanning");
    setScanMsg(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const r = await fetch(`/api/clients/${clientId}/inbody-ocr`, { method: "POST", body: fd });
      const j = (await r.json().catch(() => ({}))) as InbodyOcr & { error?: string };
      if (!r.ok) throw new Error(j.error ?? `${r.status}`);

      const merged = mergeOcr(j, values, MAPPED_KEYS, extra);
      setValues(merged.values);
      setExtra(merged.extra);
      if (merged.machine && !machine.trim()) setMachine(merged.machine);
      setScan("done");
      setScanMsg(t("flc.ocr.done").replace("{n}", String(merged.filled)));
    } catch (e) {
      setScan("error");
      setScanMsg((e as Error).message);
    }
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { notes: notes || null, extra_metrics: buildExtraMetrics(extra, machine) };
      for (const [k, v] of Object.entries(values)) {
        payload[k] = v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : v;
      }
      const r = await fetch(`/api/clients/${clientId}/health-metrics`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? `${r.status}`);
      router.refresh();
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginTop: 4 }}>
      {/* Photo OCR */}
      <div style={ocrCard}>
        <input
          ref={fileRef}
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          data-testid="log-inbody-photo"
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

      {/* Typed fields */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 10 }}>
        {INBODY_FIELDS.map(([k, labelKey, ph]) => (
          <label key={k} style={fieldLabel}>
            {t(labelKey)}
            <input
              type="number"
              step="0.01"
              data-testid={`log-${k}`}
              value={values[k]}
              onChange={(e) => setValues({ ...values, [k]: e.target.value })}
              placeholder={ph}
              style={inputStyle}
            />
          </label>
        ))}
      </div>

      {/* Machine + extras */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
          <div style={sectionLabel}>{t("flc.extra.title")}</div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              value={machine}
              onChange={(e) => setMachine(e.target.value)}
              placeholder={t("flc.extra.machine")}
              style={{ ...inputStyle, width: 150, fontSize: 11 }}
            />
            <button
              type="button"
              onClick={() => setExtra([...extra, { key: "", label: "", value: "", unit: "" }])}
              style={ghostBtn}
            >
              {t("flc.extra.add")}
            </button>
          </div>
        </div>
        {extra.length === 0 ? (
          <div style={{ fontSize: 10, color: T.muted }}>{t("flc.extra.empty")}</div>
        ) : (
          extra.map((m, i) => (
            <div key={i} style={{ display: "grid", gridTemplateColumns: "1fr 90px 70px 28px", gap: 6, alignItems: "center" }}>
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
                onClick={() => setExtra(extra.filter((_, j) => j !== i))}
                style={{ ...ghostBtn, padding: "6px 0", textAlign: "center" }}
              >
                ✕
              </button>
            </div>
          ))
        )}
      </div>

      <label style={fieldLabel}>
        {t("flc.notes")}
        <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} style={inputStyle} />
      </label>

      {error && <div style={{ fontSize: 11, color: "#fab9a9" }}>⚠ {error}</div>}

      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button type="button" onClick={onDone} disabled={saving} style={ghostBtn}>
          {t("bodycomp.cancel")}
        </button>
        <button type="button" data-testid="log-inbody-save" onClick={() => void save()} disabled={saving} style={primaryBtn(saving)}>
          {saving ? t("bodycomp.saving") : t("bodycomp.save")}
        </button>
      </div>
    </div>
  );
}

// ── styles (mirror FirstLessonCapture primitives) ────────────────────────────
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
const fieldLabel: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 10, color: T.muted };
const sectionLabel: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, color: T.text, letterSpacing: "0.08em", textTransform: "uppercase",
};
const ocrCard: React.CSSProperties = {
  padding: "12px 14px", borderRadius: 10,
  background: "rgba(98,132,88,0.10)", border: "1px dashed rgba(98,132,88,0.5)",
};
const ghostBtn: React.CSSProperties = {
  background: "transparent", border: `1px solid ${T.border}`, borderRadius: 99,
  padding: "8px 14px", color: T.mutedMid, fontSize: 11, cursor: "pointer",
};
function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "linear-gradient(135deg, rgba(98,132,88,0.95) 0%, rgba(58,82,52,0.95) 100%)",
    border: "1px solid rgba(255,252,245,0.25)", borderRadius: 99, padding: "8px 18px",
    color: "#fffdf6", fontSize: 12, fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer", opacity: disabled ? 0.6 : 1,
  };
}
