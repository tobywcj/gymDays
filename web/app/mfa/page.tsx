"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import PublicLangToggle from "@/components/PublicLangToggle";

// AAL2 step-up: a user with a verified TOTP factor lands here after sign-in
// (the middleware redirects aal1 → /mfa). They enter the current code to
// raise the session to aal2 and continue to their destination.
export default function MfaStepUpPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function safeNext() {
    const raw = new URLSearchParams(window.location.search).get("next");
    return raw && raw.startsWith("/") && !raw.startsWith("//") ? raw : "/";
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    const supabase = supabaseBrowser();

    const { data: factors, error: fErr } = await supabase.auth.mfa.listFactors();
    const factor = factors?.totp?.find((f) => f.status === "verified");
    if (fErr || !factor) {
      setErr(fErr?.message ?? "no factor");
      setBusy(false);
      return;
    }
    const { data: ch, error: chErr } = await supabase.auth.mfa.challenge({ factorId: factor.id });
    if (chErr || !ch) {
      setErr(chErr?.message ?? "challenge failed");
      setBusy(false);
      return;
    }
    const { error: vErr } = await supabase.auth.mfa.verify({
      factorId: factor.id,
      challengeId: ch.id,
      code: code.trim(),
    });
    if (vErr) {
      setErr(vErr.message);
      setBusy(false);
      return;
    }
    router.push(safeNext());
    router.refresh();
  }

  async function cancel() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        background: "radial-gradient(120% 90% at 50% 18%, #15171a 0%, #0b0c0e 45%, #050506 100%)",
      }}
    >
      <PublicLangToggle />
      <form
        onSubmit={submit}
        className="glass glass-tint-ochre"
        style={{
          borderRadius: T.radius.card,
          padding: "32px 36px",
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div>
          <div style={{ fontFamily: T.font.mono, fontSize: 22, letterSpacing: "-0.02em" }}>{t("mfa.stepUpTitle")}</div>
          <div style={{ fontSize: 12, color: T.muted, marginTop: 6, lineHeight: 1.5 }}>{t("mfa.stepUpPrompt")}</div>
        </div>

        <input
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder={t("mfa.enterCode")}
          required
          autoFocus
          data-testid="mfa-stepup-code"
          style={{
            background: "rgba(0,0,0,0.25)",
            border: `1px solid ${T.border}`,
            borderRadius: 8,
            padding: "12px 14px",
            color: T.text,
            fontFamily: T.font.mono,
            fontSize: 18,
            letterSpacing: "0.25em",
            textAlign: "center",
            outline: "none",
          }}
        />

        <button
          type="submit"
          disabled={busy}
          data-testid="mfa-stepup-verify"
          style={{
            background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
            border: "1px solid rgba(255,252,245,0.25)",
            borderRadius: 99,
            padding: "10px 18px",
            color: "#fffdf6",
            fontSize: 13,
            fontWeight: 600,
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "⏳ …" : t("mfa.verify")}
        </button>

        {err && <div data-testid="mfa-stepup-error" style={{ fontSize: 11, color: "#f87171", fontFamily: T.font.mono }}>{err}</div>}

        <button
          type="button"
          onClick={cancel}
          style={{ background: "none", border: "none", color: T.muted, fontSize: 11, cursor: "pointer", padding: 0, alignSelf: "flex-start" }}
        >
          {t("mfa.cancel")}
        </button>
      </form>
    </div>
  );
}
