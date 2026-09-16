"use client";

import { useEffect, useState } from "react";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type ProviderInfo = { channel: string; available: boolean; reason: string | null; source: string | null };
type Saved = {
  provider: string;
  credentials: Record<string, string>;
  status: string;
  last_tested_at: string | null;
  created_at: string;
};

type Catalog = { providers: Record<string, ProviderInfo>; saved: Saved[] };

type FieldSpec = { name: string; labelKey: string; type?: "text" | "password"; placeholder?: string };

const PROVIDER_FIELDS: Record<string, { titleKey: string; subtitleKey: string; learnMore: string; fields: FieldSpec[] }> = {
  telegram: {
    titleKey: "conn2.telegramTitle",
    subtitleKey: "conn2.telegramSub",
    learnMore: "https://core.telegram.org/bots#how-do-i-create-a-bot",
    fields: [
      { name: "bot_token", labelKey: "conn2.botToken", placeholder: "123456:ABC-DEF…", type: "password" },
    ],
  },
  email: {
    titleKey: "conn2.emailTitle",
    subtitleKey: "conn2.emailSub",
    learnMore: "https://resend.com/docs",
    fields: [
      { name: "api_key", labelKey: "conn2.apiKey", placeholder: "re_…",                       type: "password" },
      { name: "from",    labelKey: "conn2.from",    placeholder: "Coach <coach@gymdays.app>" },
    ],
  },
};

export default function ConnectionsPanel() {
  const { t } = useI18n();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    try {
      const r = await fetch("/api/connections", { cache: "no-store" });
      if (!r.ok) throw new Error(`${r.status}: ${await r.text()}`);
      setCatalog(await r.json());
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  useEffect(() => { refresh(); }, []);

  if (err) return <div style={{ color: "#f87171", fontSize: 12 }}>{t("conn2.error")} {err}</div>;
  if (!catalog) return <div style={{ color: T.muted, fontSize: 12 }}>{t("kb.loading")}</div>;

  const savedByProvider = Object.fromEntries(catalog.saved.map((s) => [s.provider, s]));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {Object.entries(PROVIDER_FIELDS).map(([name, spec]) => {
        const info = catalog.providers[name];
        const saved = savedByProvider[name];
        return (
          <ConnectionCard
            key={name}
            providerName={name}
            spec={spec}
            info={info}
            saved={saved}
            onChanged={refresh}
          />
        );
      })}
    </div>
  );
}

function ConnectionCard({
  providerName,
  spec,
  info,
  saved,
  onChanged,
}: {
  providerName: string;
  spec: typeof PROVIDER_FIELDS[string];
  info: ProviderInfo | undefined;
  saved: Saved | undefined;
  onChanged: () => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [form, setForm] = useState<Record<string, string>>(
    Object.fromEntries(spec.fields.map((f) => [f.name, ""])),
  );

  // Connected = we have a saved DB row for this trainer + provider.
  // Catalog availability is best-effort (AI service may be offline).
  const connected = !!saved;
  void info;  // kept for future use

  async function connect(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setSuccess(null);
    try {
      const r = await fetch(`/api/connections/${providerName}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials: form }),
      });
      const j = await r.json();
      if (!r.ok) {
        throw new Error(j.detail || j.error || `${r.status}`);
      }
      setSuccess(t("conn2.connectedToast"));
      setOpen(false);
      setForm(Object.fromEntries(spec.fields.map((f) => [f.name, ""])));
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function disconnect() {
    if (!confirm(`${t("conn2.disconnect")} ${t(spec.titleKey)}?`)) return;
    setBusy(true);
    setError(null);
    try {
      const r = await fetch(`/api/connections/${providerName}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tint = providerName === "telegram" ? "glass-tint-sage" : "glass-tint-ochre";

  return (
    <div className={`glass ${tint}`} data-testid={`connection-${providerName}`} style={{ borderRadius: T.radius.card, padding: 22 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>{t(spec.titleKey)}</div>
            <span style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              padding: "2px 8px",
              borderRadius: 99,
              background: connected ? "rgba(34,197,94,0.18)" : "rgba(244,237,226,0.08)",
              color: connected ? "#4ade80" : T.muted,
            }}>
              {connected ? t("conn2.connected") : t("conn2.notConnected")}
            </span>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>{t(spec.subtitleKey)}</div>
          <a href={spec.learnMore} target="_blank" rel="noreferrer" style={{ fontSize: 11, color: T.accent, marginTop: 6, display: "inline-block" }}>
            {t("conn2.getCreds")}
          </a>
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          {connected && (
            <button
              onClick={disconnect}
              disabled={busy}
              data-testid={`disconnect-${providerName}`}
              style={pillBtn(T.mutedMid)}
            >{t("conn2.disconnect")}</button>
          )}
          <button
            onClick={() => setOpen((v) => !v)}
            data-testid={`toggle-${providerName}`}
            style={pillBtn(T.accent, true)}
          >
            {open ? t("common.cancel") : connected ? t("conn2.reenter") : t("conn2.connect")}
          </button>
        </div>
      </div>

      {saved && (
        <div style={{ marginTop: 12, fontSize: 11, color: T.mutedMid, fontFamily: T.font.mono, background: "rgba(0,0,0,0.18)", padding: "8px 10px", borderRadius: 8 }}>
          {Object.entries(saved.credentials).map(([k, v]) => (
            <div key={k}>{k}: <span style={{ color: T.text }}>{v}</span></div>
          ))}
        </div>
      )}

      {open && (
        <form onSubmit={connect} style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          {spec.fields.map((f) => (
            <label key={f.name} style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 10, color: T.muted, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              {t(f.labelKey)}
              <input
                type={f.type || "text"}
                value={form[f.name]}
                onChange={(e) => setForm({ ...form, [f.name]: e.target.value })}
                placeholder={f.placeholder}
                required
                data-testid={`field-${providerName}-${f.name}`}
                style={{
                  background: "rgba(0,0,0,0.25)",
                  border: `1px solid ${T.border}`,
                  borderRadius: 8,
                  padding: "9px 11px",
                  color: T.text,
                  fontFamily: T.font.mono,
                  fontSize: 12,
                  outline: "none",
                }}
              />
            </label>
          ))}
          <button
            type="submit"
            disabled={busy}
            data-testid={`save-${providerName}`}
            style={{
              alignSelf: "flex-start",
              fontSize: 12,
              padding: "8px 16px",
              borderRadius: 99,
              background: "linear-gradient(135deg, rgba(98,132,88,0.95) 0%, rgba(58,82,52,0.95) 100%)",
              color: "#fffdf6",
              border: "1px solid rgba(255,252,245,0.25)",
              fontWeight: 600,
              cursor: busy ? "not-allowed" : "pointer",
              opacity: busy ? 0.7 : 1,
            }}
          >
            {busy ? t("conn2.testing") : t("conn2.testSave")}
          </button>
        </form>
      )}

      {error && (
        <div data-testid={`error-${providerName}`} style={{ marginTop: 10, fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>
          {error}
        </div>
      )}
      {success && (
        <div data-testid={`success-${providerName}`} style={{ marginTop: 10, fontSize: 11, color: "#4ade80" }}>
          {success}
        </div>
      )}
    </div>
  );
}

function pillBtn(color: string, primary = false): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "6px 14px",
    borderRadius: 99,
    border: `1px solid ${primary ? "rgba(255,252,245,0.25)" : T.border}`,
    background: primary ? "rgba(196,148,82,0.18)" : "transparent",
    color,
    cursor: "pointer",
  };
}
