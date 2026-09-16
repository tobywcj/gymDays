import { T } from "@/lib/design-tokens";
import { getLocale } from "@/lib/i18n-server";
import PublicLangToggle from "@/components/PublicLangToggle";

export const metadata = {
  title: "Support — gymDays",
  description: "Get help with your gymDays account or Strava connection.",
};

const SUPPORT_EMAIL = "tobywong42r@outlook.com";

export default async function SupportPage() {
  const zh = (await getLocale()) === "zh";
  const email = <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>;
  const stravaApps = <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer" style={link}>strava.com/settings/apps</a>;

  const faqs: Array<{ q: string; a: React.ReactNode }> = zh ? [
    { q: "我點了 Strava 邀請連結 — 它的作用是什麼？", a: "你登入了 Strava 帳號並授權 gymDays 讀取你的活動（心率、距離、時間等）。你的教練會用這些資料規劃更好的訓練課表。gymDays 不會發佈任何內容到 Strava，也只會讀取你的活動。" },
    { q: "如何中斷 Strava 連結？", a: <>兩種方式：(1) 請你的教練 — 他們可在 gymDays 內中斷你的帳號連結。(2) 前往 {stravaApps} 並撤銷 gymDays。無論哪種方式，gymDays 都會立即停止接收新活動。</> },
    { q: "如何要求刪除我的資料？", a: <>請用你註冊時的電子郵件寄信至 {email}，或告知你的教練。我們會在 30 天內刪除你的 Strava 活動紀錄、OAuth 權杖，以及與你帳號相關的所有 AI 產生內容。</> },
    { q: "我的 Strava 邀請連結顯示「已過期或無效」", a: "連結為一次性使用，7 天後失效。請教練重新發送一個新的連結。" },
  ] : [
    { q: "I clicked a Strava invitation link — what does it do?", a: "You logged into your Strava account and authorized gymDays to read your activities (heart rate, distance, time, etc.). Your coach uses this data to write better training programs. gymDays never posts to Strava and never reads anything other than your activities." },
    { q: "How do I disconnect Strava?", a: <>Two options. (1) Ask your coach — they can disconnect your account from inside gymDays. (2) Go to {stravaApps} and revoke gymDays. Either way, gymDays will stop receiving new activities immediately.</> },
    { q: "How do I request my data be deleted?", a: <>Email {email} from the email you signed up with, or ask your coach. We will delete your Strava activity history, OAuth tokens, and any AI-generated content tied to your account within 30 days.</> },
    { q: "My Strava invitation link says \"expired or invalid\"", a: "Connect links are single-use and expire after 7 days. Ask your coach to send a fresh one." },
  ];

  return (
    <div style={shell}>
      <PublicLangToggle />
      <div style={card}>
        <h1 style={h1}>{zh ? "支援" : "Support"}</h1>
        <p style={lead}>
          {zh
            ? "gymDays 是個人教練用來規劃訓練與檢視客戶進度的 AI 教練平台。如需協助請與我們聯絡 — 通常會在一個工作天內回覆。"
            : "gymDays is an AI-powered coaching platform used by personal trainers to plan training and review client progress. If you need help, contact us — we usually reply within one business day."}
        </p>

        <section style={section}>
          <h2 style={h2}>{zh ? "電子郵件" : "Email"}</h2>
          <p style={body}>{email}</p>
        </section>

        <section style={section}>
          <h2 style={h2}>{zh ? "常見問題" : "Common questions"}</h2>
          {faqs.map((f, i) => (
            <div key={i} style={qa}>
              <div style={q}>{f.q}</div>
              <div style={body}>{f.a}</div>
            </div>
          ))}
        </section>

        <footer style={footer}>
          <a href="/privacy" style={fnav}>{zh ? "隱私權" : "Privacy"}</a>
          <span style={dot}>·</span>
          <a href="/terms" style={fnav}>{zh ? "條款" : "Terms"}</a>
        </footer>
      </div>
    </div>
  );
}

const shell = { minHeight: "100vh", display: "flex", justifyContent: "center", padding: "48px 24px" } as const;
const card  = { maxWidth: 640, width: "100%", color: T.text, lineHeight: 1.6 } as const;
const h1    = { fontFamily: T.font.mono, fontSize: 28, marginBottom: 12 } as const;
const h2    = { fontFamily: T.font.mono, fontSize: 16, color: T.accent, marginBottom: 10, marginTop: 0 } as const;
const lead  = { fontSize: 14, color: T.muted, marginBottom: 32 } as const;
const section = { marginBottom: 32 } as const;
const qa    = { marginBottom: 18 } as const;
const q     = { fontSize: 13, fontWeight: 600, color: T.text, marginBottom: 4 } as const;
const body  = { fontSize: 13, color: T.muted, margin: 0 } as const;
const link  = { color: T.accent, textDecoration: "none" } as const;
const footer = { display: "flex", gap: 10, fontSize: 12, color: T.muted, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${T.border}` } as const;
const fnav  = { color: T.muted, textDecoration: "none" } as const;
const dot   = { opacity: 0.4 } as const;
