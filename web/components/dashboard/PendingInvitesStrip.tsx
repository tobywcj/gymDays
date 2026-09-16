import Link from "next/link";
import { T } from "@/lib/design-tokens";
import { t as translate, type Locale } from "@/lib/i18n";
import { daysLeft, timeAgoCoarse } from "@/lib/relative-time";

type PendingInvite = {
  client_id: string;
  client_name: string;
  token: string;
  expires_at: string;
  accepted_at: string | null;
};

export default function PendingInvitesStrip({ invites, locale }: { invites: PendingInvite[]; locale: Locale }) {
  if (invites.length === 0) return null;

  const pending = invites.filter((i) => !i.accepted_at).length;
  const completed = invites.length - pending;

  return (
    <div
      data-testid="pending-invites"
      style={{
        borderRadius: T.radius.card,
        padding: "14px 18px",
        background: "rgba(20, 28, 18, 0.55)",
        border: "1px solid rgba(255, 252, 245, 0.08)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: "#fffdf6",
          }}
        >
          {translate(locale, "invites.title")}
        </span>
        <span style={{ fontSize: 11, color: "#e4b06a" }}>
          {pending} {translate(locale, "invites.waiting")}
        </span>
        <span style={{ fontSize: 11, color: "#7fb56e" }}>
          · {completed} {translate(locale, "invites.filled")}
        </span>
      </div>
      <div
        style={{
          display: "flex",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        {invites.map((i) => {
          const isCompleted = !!i.accepted_at;
          const href = isCompleted
            ? `/clients/${i.client_id}`
            : `/clients/new?invited=${i.client_id}&token=${i.token}`;
          return (
            <Link
              key={i.token}
              href={href}
              data-testid={`pending-invite-${i.client_id}`}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 6,
                padding: "12px 16px",
                borderRadius: 12,
                border: `1px solid ${isCompleted ? "rgba(127, 181, 110, 0.7)" : "rgba(228, 176, 106, 0.7)"}`,
                background: isCompleted
                  ? "rgba(98, 132, 88, 0.35)"
                  : "rgba(60, 44, 26, 0.65)",
                textDecoration: "none",
                color: "#fffdf6",
                minWidth: 220,
                maxWidth: 280,
                boxShadow: "0 2px 10px rgba(0,0,0,0.35)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span
                  style={{
                    display: "inline-block",
                    width: 10,
                    height: 10,
                    borderRadius: 99,
                    background: isCompleted ? "#7fb56e" : "#e4b06a",
                    flexShrink: 0,
                    boxShadow: isCompleted
                      ? "0 0 8px rgba(127, 181, 110, 0.9)"
                      : "0 0 8px rgba(228, 176, 106, 0.9)",
                  }}
                />
                <span
                  style={{
                    fontSize: 14,
                    fontWeight: 600,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    color: "#fffdf6",
                  }}
                >
                  {i.client_name}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    color: isCompleted ? "#cfe6c2" : "#f0d4a4",
                  }}
                >
                  {isCompleted ? translate(locale, "invites.screeningFilled") : translate(locale, "invites.waitingScreening")}
                </span>
                <span style={{ fontSize: 10, color: T.mutedMid }}>
                  {isCompleted
                    ? `${translate(locale, "invites.submitted")} ${timeAgoCoarse(locale, i.accepted_at!)}`
                    : `${translate(locale, "invites.linkExpires")} ${daysLeft(locale, i.expires_at)}`}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
