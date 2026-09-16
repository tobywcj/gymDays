"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type Factor = { id: string; status: string };
type Enrolling = { factorId: string; challengeId: string; qr: string; secret: string };

// Self-service TOTP (authenticator app) management. Shows current factor state
// and walks the user through enroll → scan QR → verify, or removal.
export default function MfaPanel() {
  const { t } = useI18n();
  const supabase = supabaseBrowser();

  const [factor, setFactor] = useState<Factor | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function refresh() {
    const { data } = await supabase.auth.mfa.listFactors();
    const totp = data?.totp?.find((f) => f.status === "verified") ?? data?.totp?.[0] ?? null;
    setFactor(totp ? { id: totp.id, status: totp.status } : null);
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startEnroll() {
    setBusy(true);
    setErr(null);
    // Clear any stale unverified factor so re-enrolling never collides.
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.totp ?? []) {
      if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id });
    }
    const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
    if (error || !data) {
      setErr(error?.message ?? "enroll failed");
      setBusy(false);
      return;
    }
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: data.id });
    if (chErr || !ch) {
      setErr(chErr?.message ?? "challenge failed");
      setBusy(false);
      return;
    }
    setEnrolling({ factorId: data.id, challengeId: ch.id, qr: data.totp.qr_code, secret: data.totp.secret });
    setBusy(false);
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!enrolling) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.mfa.verify({
      factorId: enrolling.factorId,
      challengeId: enrolling.challengeId,
      code: code.trim(),
    });
    if (error) {
      setErr(error.message);
      setBusy(false);
      return;
    }
    setEnrolling(null);
    setCode("");
    setBusy(false);
    await refresh();
  }

  async function remove() {
    if (!factor) return;
    if (!confirm(t("mfa.removeConfirm"))) return;
    setBusy(true);
    setErr(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) setErr(error.message);
    setBusy(false);
    await refresh();
  }

  const enabled = factor?.status === "verified";

  return (
    <div className="glass glass-tint-ochre" style={{ borderRadius: T.radius.card, padding: 22 }}>
      <div style={{ fontSize: 14, fontWeight: 700 }}>{t("mfa.title")}</div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.5 }}>{t("mfa.intro")}</div>

      {loaded && !enrolling && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginTop: 16 }}>
          <div style={{ fontSize: 12, color: enabled ? T.accentMoss : T.mutedMid }}>
            {enabled ? `✅ ${t("mfa.enabled")}` : t("mfa.disabled")}
          </div>
          {enabled ? (
            <button type="button" onClick={remove} disabled={busy} data-testid="mfa-remove" style={pillBtn}>
              {t("mfa.remove")}
            </button>
          ) : (
            <button type="button" onClick={startEnroll} disabled={busy} data-testid="mfa-add" style={primaryBtn(busy)}>
              {t("mfa.add")}
            </button>
          )}
        </div>
      )}

      {enrolling && (
        <form onSubmit={verify} style={{ marginTop: 16, display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ fontSize: 11.5, color: T.mutedMid, lineHeight: 1.5 }}>{t("mfa.scan")}</div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={enrolling.qr}
            alt="TOTP QR"
            width={160}
            height={160}
            style={{ background: "white", borderRadius: 8, padding: 8, alignSelf: "flex-start" }}
          />
          <div style={{ fontSize: 10.5, color: T.muted }}>
            {t("mfa.secret")}{" "}
            <code style={{ fontFamily: T.font.mono, color: T.text, wordBreak: "break-all" }}>{enrolling.secret}</code>
          </div>
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            placeholder={t("mfa.enterCode")}
            required
            data-testid="mfa-code"
            style={inputStyle}
          />
          <button type="submit" disabled={busy} data-testid="mfa-verify" style={primaryBtn(busy)}>
            {t("mfa.verify")}
          </button>
        </form>
      )}

      {err && <div style={{ fontSize: 11, color: "#f87171", marginTop: 10, fontFamily: T.font.mono }}>{err}</div>}
    </div>
  );
}

const pillBtn: React.CSSProperties = {
  fontSize: 11,
  padding: "6px 14px",
  borderRadius: 99,
  border: `1px solid ${T.border}`,
  background: "transparent",
  color: T.mutedMid,
  cursor: "pointer",
};

const primaryBtn = (busy: boolean): React.CSSProperties => ({
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
});

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "10px 12px",
  color: T.text,
  fontFamily: T.font.mono,
  fontSize: 14,
  letterSpacing: "0.2em",
  maxWidth: 200,
  outline: "none",
};
