"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/client";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import PublicLangToggle from "@/components/PublicLangToggle";
import BatMark from "@/components/BatMark";
import GymScene from "@/components/login/GymScene";
import BatFlight from "@/components/login/BatFlight";

export default function LoginPage() {
  const router = useRouter();
  const { t } = useI18n();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mode, setMode] = useState<"magic" | "password">("magic");
  const [audience, setAudience] = useState<"trainer" | "client">("trainer");
  const [status, setStatus] = useState<string | null>(null);
  const [statusErr, setStatusErr] = useState(false);
  const [busy, setBusy] = useState(false);
  const [warping, setWarping] = useState(false);
  const pendingNext = useRef("/");

  const onFlightDone = useCallback(() => {
    router.push(pendingNext.current);
    router.refresh();
  }, [router]);

  function safeNext() {
    // Where to land after auth, preserved by the middleware as ?next=.
    const rawNext = new URLSearchParams(window.location.search).get("next");
    if (rawNext && rawNext.startsWith("/") && !rawNext.startsWith("//")) return rawNext;
    // No explicit target: send clients to their portal, trainers to the dashboard.
    return audience === "client" ? "/portal" : "/";
  }

  async function social(provider: "google" | "github") {
    setBusy(true);
    setStatus(null);
    setStatusErr(false);
    const supabase = supabaseBrowser();
    const next = safeNext();
    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });
    if (error) {
      setStatusErr(true);
      setStatus(`${t("conn2.error")} ${error.message}`);
      setBusy(false);
    }
    // On success the browser is redirected to the provider; nothing else to do.
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setStatus(null);
    setStatusErr(false);
    const supabase = supabaseBrowser();

    const next = safeNext();

    if (mode === "magic") {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: {
          emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
        },
      });
      setStatusErr(!!error);
      setStatus(error ? `${t("conn2.error")} ${error.message}` : t("lg.checkInbox"));
      setBusy(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setStatusErr(true);
      setStatus(`${t("conn2.error")} ${error.message}`);
      setBusy(false);
      return;
    }
    // Take off into the flappy-bat flight; navigate when it lands.
    pendingNext.current = next;
    setWarping(true);
  }

  return (
    <div
      style={{
        position: "relative",
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 24,
        overflow: "hidden",
        // Bat-black, cave-like backdrop so the glass card reads against deep dark.
        background:
          "radial-gradient(120% 90% at 50% 18%, #15171a 0%, #0b0c0e 45%, #050506 100%)",
      }}
    >
      <GymScene />
      <BatFlight active={warping} onComplete={onFlightDone} />
      <PublicLangToggle />
      <form
        onSubmit={submit}
        className="glass glass-tint-ochre"
        style={{
          position: "relative",
          zIndex: 1,
          borderRadius: T.radius.card,
          padding: "32px 36px",
          width: "100%",
          maxWidth: 380,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <BatMark size={48} style={{ color: "#ffffff", flexShrink: 0 }} />
          <div>
            <div style={{ fontFamily: T.font.mono, fontSize: 24, letterSpacing: "-0.02em" }}>Gym Days</div>
            <div style={{ fontSize: 12, color: T.muted, marginTop: 4 }}>
              {audience === "client" ? t("lg.signinClient") : t("lg.signin")}
            </div>
          </div>
        </div>

        {/* Audience: trainer vs client (changes where you land after sign-in) */}
        <div
          style={{
            display: "flex",
            gap: 4,
            padding: 4,
            borderRadius: 12,
            background: "rgba(0,0,0,0.22)",
            border: `1px solid ${T.border}`,
          }}
        >
          {(["trainer", "client"] as const).map((aud) => {
            const active = audience === aud;
            return (
              <button
                key={aud}
                type="button"
                onClick={() => setAudience(aud)}
                data-testid={`audience-${aud}`}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 9,
                  border: "none",
                  fontSize: 12.5,
                  fontWeight: 600,
                  cursor: "pointer",
                  color: active ? "#fffdf6" : T.mutedMid,
                  background: active
                    ? "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)"
                    : "transparent",
                  boxShadow: active ? "0 1px 0 rgba(255,252,245,0.35) inset" : "none",
                }}
              >
                {aud === "trainer" ? t("lg.trainer") : t("lg.client")}
              </button>
            );
          })}
        </div>

        <div style={{ display: "flex", gap: 6, fontSize: 11 }}>
          <button
            type="button"
            onClick={() => setMode("magic")}
            data-testid="mode-magic"
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: mode === "magic" ? "rgba(196,148,82,0.18)" : "transparent",
              color: mode === "magic" ? "#e4c08c" : T.mutedMid,
              cursor: "pointer",
            }}
          >
            {t("lg.magic")}
          </button>
          <button
            type="button"
            onClick={() => setMode("password")}
            data-testid="mode-password"
            style={{
              flex: 1,
              padding: "6px 10px",
              borderRadius: 8,
              border: `1px solid ${T.border}`,
              background: mode === "password" ? "rgba(196,148,82,0.18)" : "transparent",
              color: mode === "password" ? "#e4c08c" : T.mutedMid,
              cursor: "pointer",
            }}
          >
            {t("lg.password")}
          </button>
        </div>

        {/* Small explainer for the selected sign-in method */}
        <div style={{ fontSize: 11, lineHeight: 1.4, color: T.muted, marginTop: -6 }}>
          {mode === "magic" ? t("lg.magicHint") : t("lg.passwordHint")}
        </div>

        <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.muted }}>
          {t("lg.email")}
          <input
            type="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            data-testid="email"
            style={{
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              color: T.text,
              fontSize: 13,
              outline: "none",
            }}
          />
        </label>

        {mode === "password" && (
          <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.muted }}>
            {t("lg.password")}
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              data-testid="password"
              style={{
                background: "rgba(0,0,0,0.25)",
                border: `1px solid ${T.border}`,
                borderRadius: 8,
                padding: "10px 12px",
                color: T.text,
                fontSize: 13,
                outline: "none",
              }}
            />
          </label>
        )}

        <button
          type="submit"
          disabled={busy}
          data-testid="submit"
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
            boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(140,92,48,0.45)",
          }}
        >
          {busy ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: 8, color: "#fffdf6" }}>
              <BatMark size={18} flapping speed={0.4} /> …
            </span>
          ) : mode === "magic" ? t("lg.sendMagic") : t("lg.signinBtn")}
        </button>

        {status && (
          <div data-testid="status" style={{ fontSize: 11, color: statusErr ? "#f87171" : T.mutedMid }}>
            {status}
          </div>
        )}

        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 2 }}>
          <div style={{ flex: 1, height: 1, background: T.border }} />
          <span style={{ fontSize: 10, color: T.muted, letterSpacing: "0.04em" }}>{t("lg.orSocial")}</span>
          <div style={{ flex: 1, height: 1, background: T.border }} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <SocialButton provider="google" label={t("lg.google")} busy={busy} onClick={() => social("google")} icon={<GoogleIcon />} />
          <SocialButton provider="github" label={t("lg.github")} busy={busy} onClick={() => social("github")} icon={<GithubIcon />} />
        </div>
      </form>
    </div>
  );
}

function SocialButton({
  label,
  busy,
  onClick,
  icon,
}: {
  provider: string;
  label: string;
  busy: boolean;
  onClick: () => void;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid={`oauth-${label.toLowerCase()}`}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
        padding: "9px 14px",
        borderRadius: 99,
        border: `1px solid ${T.border}`,
        background: "rgba(0,0,0,0.20)",
        color: T.text,
        fontSize: 12.5,
        fontWeight: 500,
        cursor: busy ? "not-allowed" : "pointer",
        opacity: busy ? 0.6 : 1,
      }}
    >
      <span style={{ display: "inline-flex", width: 16, height: 16 }}>{icon}</span>
      {label}
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 48 48" width="16" height="16" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 24 44a20 20 0 0 0 19.6-23.5z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2A12 12 0 0 1 12.7 28l-6.6 5.1A20 20 0 0 0 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4.1 5.6l6.2 5.2C42.9 35.4 44 30 44 24c0-1.2-.1-2.4-.4-3.5z" />
    </svg>
  );
}

function GithubIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden>
      <path d="M12 .5a12 12 0 0 0-3.8 23.4c.6.1.8-.3.8-.6v-2c-3.3.7-4-1.6-4-1.6-.6-1.4-1.4-1.8-1.4-1.8-1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.8 1.3 3.5 1 .1-.8.4-1.3.7-1.6-2.7-.3-5.5-1.3-5.5-5.9 0-1.3.5-2.4 1.2-3.2 0-.4-.5-1.6.2-3.2 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17 5 18 5.3 18 5.3c.7 1.6.2 2.8.1 3.2.8.8 1.2 1.9 1.2 3.2 0 4.6-2.8 5.6-5.5 5.9.4.4.8 1.1.8 2.2v3.3c0 .3.2.7.8.6A12 12 0 0 0 12 .5Z" />
    </svg>
  );
}
