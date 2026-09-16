"use client";

import { useEffect, useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type Secret = {
  key: string;
  masked: string;
  label: string | null;
  created_at: string;
  updated_at: string;
};

// Common bring-your-own keys offered as quick suggestions, each with a short
// purpose string (i18n key). Trainers can still type ANY key name they like.
const SUGGESTED: { key: string; purposeKey: string }[] = [
  { key: "GEMINI_API_KEY", purposeKey: "secrets.purpose.gemini" },
  { key: "ANTHROPIC_API_KEY", purposeKey: "secrets.purpose.anthropic" },
  { key: "OPENAI_API_KEY", purposeKey: "secrets.purpose.openai" },
  { key: "STRAVA_CLIENT_SECRET", purposeKey: "secrets.purpose.strava" },
  { key: "CF_ACCOUNT_ID", purposeKey: "secrets.purpose.cfAccount" },
  { key: "CF_API_TOKEN", purposeKey: "secrets.purpose.cfToken" },
  { key: "HF_TOKEN", purposeKey: "secrets.purpose.hf" },
  { key: "POLLINATIONS_TOKEN", purposeKey: "secrets.purpose.pollinations" },
];
const PURPOSE_BY_KEY: Record<string, string> = Object.fromEntries(
  SUGGESTED.map((s) => [s.key, s.purposeKey]),
);

export default function SecretsPanel() {
  const { t } = useI18n();
  const [secrets, setSecrets] = useState<Secret[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [formErr, setFormErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/secrets", { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setSecrets((await r.json()).secrets);
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => { refresh(); }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setFormErr(null);
    setSuccess(null);
    try {
      const r = await fetch("/api/secrets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key: key.trim(), value, label: label.trim() }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      setSuccess(t("secrets.savedToast"));
      setKey("");
      setValue("");
      setLabel("");
      refresh();
    } catch (e) {
      setFormErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove(k: string) {
    if (!confirm(`${t("secrets.deleteConfirm")} ${k}?`)) return;
    try {
      const r = await fetch(`/api/secrets?key=${encodeURIComponent(k)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {/* Add / update form */}
      <div className="glass glass-tint-ochre" data-testid="secret-form" style={{ borderRadius: T.radius.card, padding: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700 }}>{t("secrets.addTitle")}</div>
        <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{t("secrets.addSub")}</div>

        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
          {SUGGESTED.map((s) => {
            const selected = key === s.key;
            return (
              <button
                key={s.key}
                type="button"
                onClick={() => setKey(s.key)}
                style={{
                  fontSize: 10.5,
                  fontFamily: T.font.mono,
                  padding: "4px 10px",
                  borderRadius: 99,
                  border: `1px solid ${T.border}`,
                  background: selected ? "rgba(196,148,82,0.18)" : "transparent",
                  color: selected ? T.accent : T.mutedMid,
                  cursor: "pointer",
                }}
              >{s.key}</button>
            );
          })}
        </div>

        <form onSubmit={save} style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <Field label={t("secrets.keyLabel")}>
            <input
              value={key}
              onChange={(e) => setKey(e.target.value)}
              placeholder="ANTHROPIC_API_KEY"
              required
              data-testid="secret-key"
              style={inputStyle}
            />
            {PURPOSE_BY_KEY[key.trim()] && (
              <span data-testid="secret-key-purpose" style={{ fontSize: 10.5, color: T.accent, textTransform: "none", letterSpacing: 0 }}>
                {t(PURPOSE_BY_KEY[key.trim()])}
              </span>
            )}
          </Field>
          <Field label={t("secrets.valueLabel")}>
            <input
              type="password"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="sk-…"
              required
              data-testid="secret-value"
              style={inputStyle}
            />
          </Field>
          <Field label={t("secrets.noteLabel")}>
            <input
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder={t("secrets.notePlaceholder")}
              data-testid="secret-label"
              style={inputStyle}
            />
          </Field>
          <button
            type="submit"
            disabled={busy}
            data-testid="secret-save"
            style={{
              alignSelf: "flex-start",
              fontSize: 12,
              padding: "8px 16px",
              borderRadius: 99,
              background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
              color: "#fffdf6",
              border: "1px solid rgba(255,252,245,0.25)",
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? t("secrets.saving") : t("secrets.save")}
          </button>
          {formErr && <div data-testid="secret-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{formErr}</div>}
          {success && <div data-testid="secret-success" style={{ fontSize: 11, color: "#4ade80" }}>{success}</div>}
        </form>
      </div>

      {/* Saved secrets */}
      <div className="glass" style={{ borderRadius: T.radius.card, padding: 22 }}>
        <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>{t("secrets.savedTitle")}</div>
        {err && <div style={{ color: "#f87171", fontSize: 12 }}>{err}</div>}
        {!secrets && !err && <div style={{ color: T.muted, fontSize: 12 }}>{t("kb.loading")}</div>}
        {secrets && secrets.length === 0 && (
          <div style={{ color: T.muted, fontSize: 12 }}>{t("secrets.empty")}</div>
        )}
        {secrets && secrets.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {secrets.map((s) => (
              <div
                key={s.key}
                data-testid={`secret-row-${s.key}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  background: "rgba(0,0,0,0.18)",
                  borderRadius: 10,
                  padding: "10px 12px",
                }}
              >
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: 12.5, fontWeight: 600, fontFamily: T.font.mono, color: T.text }}>{s.key}</div>
                  {PURPOSE_BY_KEY[s.key] && (
                    <div style={{ fontSize: 10.5, color: T.mutedMid, marginTop: 1 }}>{t(PURPOSE_BY_KEY[s.key])}</div>
                  )}
                  <div style={{ fontSize: 11, color: T.muted, fontFamily: T.font.mono, marginTop: 1 }}>
                    {s.masked}{s.label ? ` · ${s.label}` : ""}
                  </div>
                </div>
                <button
                  onClick={() => remove(s.key)}
                  data-testid={`secret-delete-${s.key}`}
                  style={{
                    fontSize: 11,
                    padding: "5px 12px",
                    borderRadius: 99,
                    border: `1px solid ${T.border}`,
                    background: "transparent",
                    color: T.mutedMid,
                    cursor: "pointer",
                    flexShrink: 0,
                  }}
                >{t("secrets.delete")}</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
      {label}
      {children}
    </label>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "9px 11px",
  color: T.text,
  fontFamily: T.font.mono,
  fontSize: 12,
  outline: "none",
};
