"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";

type Props = { url: string; telegramHandle: string | null };

export default function InviteShareCard({ url, telegramHandle }: Props) {
  const [copied, setCopied] = useState(false);

  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=10&data=${encodeURIComponent(url)}`;
  const shareText = telegramHandle
    ? `Hi @${telegramHandle} — please complete your pre-training screening here: ${url}`
    : `Hi — please complete your pre-training screening here: ${url}`;
  const telegramShareUrl = `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* ignore */ }
  }

  return (
    <div data-testid="invite-result" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ fontSize: 12, color: T.mutedMid }}>
        Client created. Share this link (valid 14 days):
      </div>

      <div style={{ display: "flex", gap: 16, alignItems: "flex-start" }}>
        <img
          src={qrSrc}
          alt="QR code for onboarding link"
          width={140}
          height={140}
          style={{ borderRadius: 8, background: "white", padding: 4 }}
        />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 10 }}>
          <input
            readOnly
            data-testid="invite-link"
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            style={{
              background: "rgba(0,0,0,0.25)",
              border: `1px solid ${T.border}`,
              borderRadius: 8,
              padding: "10px 12px",
              color: T.text,
              fontFamily: T.font.mono,
              fontSize: 11,
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              onClick={copy}
              data-testid="invite-copy"
              style={pillStyle(copied ? T.accent : T.mutedMid)}
            >
              {copied ? "Copied ✓" : "Copy link"}
            </button>
            <a
              href={telegramShareUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="invite-telegram-share"
              style={{
                ...pillStyle("#0088cc"),
                textDecoration: "none",
                display: "inline-block",
              }}
            >
              Share via Telegram
            </a>
          </div>
          {telegramHandle && (
            <div style={{ fontSize: 10, color: T.muted }}>
              Will be sent to <span style={{ color: T.text }}>@{telegramHandle}</span>
            </div>
          )}
        </div>
      </div>

      <a href="/" style={{ fontSize: 12, color: T.accent, alignSelf: "flex-start" }}>
        ← Back to dashboard
      </a>
    </div>
  );
}

function pillStyle(color: string): React.CSSProperties {
  return {
    fontSize: 11,
    padding: "6px 12px",
    borderRadius: 99,
    border: `1px solid ${color}`,
    background: "transparent",
    color,
    cursor: "pointer",
    fontWeight: 600,
  };
}
