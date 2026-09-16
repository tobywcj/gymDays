"use client";

import { useEffect, useState } from "react";
import { T } from "@/lib/design-tokens";

type Props = {
  clientId: string;
  linked: boolean;       // client.telegram_chat_id present?
  chatId: string | null;
};

export default function TelegramLinkCard({ clientId, linked, chatId }: Props) {
  const [botUsername, setBotUsername] = useState<string | null>(null);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    fetch("/api/telegram/bot-info", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        setConfigured(!!d.configured);
        setBotUsername(d.username ?? null);
      })
      .catch(() => setConfigured(false));
  }, []);

  const deepLink = botUsername ? `https://t.me/${botUsername}?start=${clientId}` : null;

  async function copy() {
    if (!deepLink) return;
    await navigator.clipboard.writeText(deepLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="glass glass-tint-sage" data-testid="telegram-link-card" style={{ borderRadius: T.radius.card, padding: 22, display: "flex", flexDirection: "column", gap: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0, flex: "1 1 200px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Telegram</div>
            <span style={{
              fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase",
              padding: "2px 8px", borderRadius: 99,
              background: linked ? "rgba(34,197,94,0.18)" : "rgba(244,237,226,0.08)",
              color: linked ? "#4ade80" : T.muted,
            }}>
              {linked ? "Linked" : "Not linked"}
            </span>
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4, lineHeight: 1.5 }}>
            Send the client this link — tapping it opens your bot and connects their chat so the
            concierge agent can answer them and flows can message them.
          </div>
          {linked && (
            <div style={{ fontSize: 11, color: T.mutedMid, marginTop: 6, fontFamily: T.font.mono }}>
              chat id: {chatId}
            </div>
          )}
        </div>
      </div>

      {configured === false && (
        <div data-testid="telegram-not-configured" style={{ fontSize: 11, color: "#fbbf24" }}>
          No Telegram bot configured yet. Add a bot token on the{" "}
          <a href="/connections" style={{ color: T.accent }}>Connections</a> page, and start the bridge
          (<code style={{ fontFamily: T.font.mono }}>cd telegram-bridge &amp;&amp; npm start</code>).
        </div>
      )}

      {deepLink && (
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          <input
            readOnly
            data-testid="telegram-deep-link"
            value={deepLink}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              flex: "1 1 240px",
              minWidth: 0,
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "9px 11px",
              color: T.text,
              fontFamily: T.font.mono,
              fontSize: 12,
            }}
          />
          <button
            onClick={copy}
            data-testid="telegram-copy"
            style={{
              fontSize: 12, padding: "8px 14px", borderRadius: 99,
              border: `1px solid ${T.border}`, background: "transparent",
              color: T.accent, cursor: "pointer", flexShrink: 0,
            }}
          >
            {copied ? "Copied!" : "Copy link"}
          </button>
        </div>
      )}
    </div>
  );
}
