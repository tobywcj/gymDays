import { T } from "@/lib/design-tokens";

type Props = { searchParams: Promise<{ reason?: string }> };

export default async function StravaErrorPage({ searchParams }: Props) {
  const { reason } = await searchParams;
  const missingScope = reason === "missing_activity_permission";
  return (
    <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
      <div
        className="glass"
        data-testid="strava-public-error"
        style={{ borderRadius: T.radius.card, padding: 32, maxWidth: 440, textAlign: "center" }}
      >
        <div style={{ fontFamily: T.font.mono, fontSize: 22, marginBottom: 8 }}>Connection failed</div>
        <div style={{ fontSize: 13, color: T.muted, lineHeight: 1.5 }}>
          {missingScope ? (
            <>
              gymDays needs permission to see your activities. Tap the link again
              and make sure <strong>“View data about your activities”</strong> is
              checked on the Strava screen.
            </>
          ) : (
            <>
              {reason ? <code style={{ fontSize: 12 }}>{reason}</code> : "Something went wrong."}
              <br />Ask your coach to send a fresh link.
            </>
          )}
        </div>
      </div>
    </div>
  );
}
