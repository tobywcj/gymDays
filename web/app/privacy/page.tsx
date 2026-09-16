import { T } from "@/lib/design-tokens";
import { getLocale } from "@/lib/i18n-server";
import PublicLangToggle from "@/components/PublicLangToggle";

export const metadata = {
  title: "Privacy Policy — gymDays",
  description: "How gymDays collects, uses, and protects your data.",
};

const SUPPORT_EMAIL = "tobywong42r@outlook.com";
const EFFECTIVE = "2026-05-31";

export default async function PrivacyPage() {
  const zh = (await getLocale()) === "zh";
  const email = <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>;
  const stravaApps = <a href="https://www.strava.com/settings/apps" target="_blank" rel="noreferrer" style={link}>strava.com/settings/apps</a>;

  const sections: Array<{ title: string; body: React.ReactNode }> = zh ? [
    { title: "1. 我們收集哪些資料", body: <>
      <p style={body}><strong>帳號資料</strong>（教練）：姓名、電子郵件、密碼雜湊。於註冊時提供。</p>
      <p style={body}><strong>客戶個人資料</strong>：姓名、聯絡方式、訓練目標、時間表、受傷史、可用器材。由你的教練或你透過入會問卷連結填寫。</p>
      <p style={body}><strong>Strava 活動資料</strong>：當你透過 Strava OAuth 授權 gymDays 時，我們會使用 Strava API 讀取你的活動（日期、類型、時間、距離、心率、爬升、辛苦分數、熱量）。我們不會發佈任何內容到 Strava，且僅要求 <code style={code}>read,activity:read_all</code> 權限。</p>
      <p style={body}><strong>訊息中繼資料</strong>：若你的教練將 gymDays 連結到你的 Telegram，我們會儲存你的聊天 ID 以便傳送排程回報。我們不會讀取我們機器人對話以外的訊息。</p>
      <p style={body}><strong>AI 產生內容</strong>：以上述資料為基礎，由我們的 AI 代理產生的訓練課表、進度報告與營養建議。</p>
    </> },
    { title: "2. 我們為何收集", body: <p style={body}>僅為提供教練服務：讓你的教練檢視你的訓練、產生個人化課表，以及傳送提醒／回報。我們不會販售你的資料、用於廣告，或為第三方的行銷目的分享。</p> },
    { title: "3. 我們如何分享", body: <>
      <p style={body}><strong>你的教練</strong>可檢視與你客戶紀錄相關的所有資料。這正是本服務的核心目的。</p>
      <p style={body}><strong>基礎設施供應商</strong>：Supabase（資料庫託管，歐盟／美國）、Anthropic 與 OpenAI（AI 代理的 LLM 推論）。我們僅為產生回應而傳送相關脈絡（你的目標、近期活動、先前課表）給這些 LLM 供應商；依其 API 合約，他們不會保留或用於訓練。</p>
      <p style={body}>我們不會與其他任何人分享你的資料。我們絕不與 Strava 合作夥伴或廣告商分享。</p>
    </> },
    { title: "4. Strava 專屬條款", body: <>
      <p style={body}>連結 Strava 即表示你授權 gymDays 依你授予的權限存取活動資料。你可隨時撤銷存取：</p>
      <ul style={list}>
        <li>於 gymDays 內 — 請你的教練中斷連結，或於你的帳號使用中斷選項。</li>
        <li>於 Strava — 前往 {stravaApps} 並撤銷 gymDays。</li>
      </ul>
      <p style={body}>撤銷後，gymDays 會立即停止接收新活動。已擷取的活動仍會保留在教練檢視中，除非你另外要求刪除（見 §6）。</p>
    </> },
    { title: "5. 我們保留多久", body: <p style={body}>只要你的客戶紀錄仍在使用中，我們便會保留你的資料。若你的教練刪除你的紀錄，所有相關資料（個人資料、活動、AI 輸出、訊息）將於 30 天內刪除。你可隨時直接要求刪除（§6）。</p> },
    { title: "6. 你的權利 — 存取、更正、刪除", body: <p style={body}>你可隨時要求取得副本、更正或刪除你的資料。請用與你帳號相關的電子郵件寄信至 {email}，或告知你的教練。我們將於 30 天內處理。</p> },
    { title: "7. 安全性", body: <p style={body}>資料由 Supabase 以靜態加密儲存。OAuth 權杖儲存於伺服器端，絕不暴露於瀏覽器。所有資料庫存取皆遵循最小權限原則。</p> },
    { title: "8. 本政策的變更", body: <p style={body}>若有重大變更，我們會以電子郵件通知教練，並更新本頁頂端的生效日期。</p> },
    { title: "9. 聯絡", body: <p style={body}>問題、申訴或要求：{email}。</p> },
  ] : [
    { title: "1. What we collect", body: <>
      <p style={body}><strong>Account data</strong> (trainers): name, email, password hash. Provided when you sign up.</p>
      <p style={body}><strong>Client profile data</strong>: name, contact details, training goal, schedule, injury history, equipment access. Entered by your trainer or by you via an onboarding intake link.</p>
      <p style={body}><strong>Strava activity data</strong>: when you authorize gymDays via Strava OAuth, we read your activities (date, type, duration, distance, heart rate, elevation, suffer score, calories) using Strava's API. We never post to Strava. We only request the <code style={code}>read,activity:read_all</code> scopes.</p>
      <p style={body}><strong>Messaging metadata</strong>: if your trainer connects gymDays to your Telegram, we store your chat ID so the platform can deliver scheduled check-ins. We do not read messages outside our own bot conversation.</p>
      <p style={body}><strong>AI-generated content</strong>: workout plans, progress reports, and nutrition suggestions produced by our AI agents on top of the data above.</p>
    </> },
    { title: "2. Why we collect it", body: <p style={body}>Solely to provide the coaching service: enabling your trainer to view your training, generating personalized plans, and delivering reminders/check-ins. We do not sell your data, use it for advertising, or share it with third parties for their own marketing.</p> },
    { title: "3. How we share it", body: <>
      <p style={body}><strong>Your trainer</strong> can see all data tied to your client record. That is the entire point of the service.</p>
      <p style={body}><strong>Infrastructure providers</strong>: Supabase (database hosting, EU/US), Anthropic & OpenAI (LLM inference for AI agents). We send relevant context (your goal, recent activities, prior plans) to these LLM providers strictly to generate responses; they do not retain or train on this data per their API contracts.</p>
      <p style={body}>We do not share your data with anyone else. We never share it with Strava partners or advertisers.</p>
    </> },
    { title: "4. Strava-specific terms", body: <>
      <p style={body}>By connecting Strava, you authorize gymDays to access activity data under the scopes you grant. You can revoke access at any time:</p>
      <ul style={list}>
        <li>From inside gymDays — ask your trainer to disconnect, or use the disconnect option on your account.</li>
        <li>From Strava — go to {stravaApps} and revoke gymDays.</li>
      </ul>
      <p style={body}>When you revoke access, gymDays will stop receiving new activities immediately. Activities already pulled remain in your trainer's view unless you also request deletion (see §6).</p>
    </> },
    { title: "5. How long we keep it", body: <p style={body}>We keep your data for as long as your client record is active. If your trainer deletes your record, all linked data (profile, activities, AI outputs, messages) is deleted within 30 days. You can request deletion directly at any time (§6).</p> },
    { title: "6. Your rights — access, correction, deletion", body: <p style={body}>You can request a copy of, correction to, or deletion of your data at any time. Email {email} from the email tied to your account, or ask your trainer. We will action requests within 30 days.</p> },
    { title: "7. Security", body: <p style={body}>Data is stored encrypted at rest by Supabase. OAuth tokens are stored server-side and never exposed to the browser. We follow the principle of least privilege for all database access.</p> },
    { title: "8. Changes to this policy", body: <p style={body}>If we make material changes we will notify trainers by email and update the effective date at the top of this page.</p> },
    { title: "9. Contact", body: <p style={body}>Questions, complaints, or requests: {email}.</p> },
  ];

  return (
    <div style={shell}>
      <PublicLangToggle />
      <div style={card}>
        <h1 style={h1}>{zh ? "隱私權政策" : "Privacy Policy"}</h1>
        <p style={meta}>{zh ? "生效日期" : "Effective"} {EFFECTIVE}</p>

        <p style={lead}>
          {zh
            ? "gymDays（「我們」）是個人教練用來規劃訓練與檢視客戶進度的 AI 教練平台。本政策說明我們收集哪些資料、原因，以及你如何控制這些資料。"
            : "gymDays (\"we\", \"us\") is an AI-powered coaching platform used by personal trainers to plan training and review client progress. This policy explains what data we collect, why, and how you can control it."}
        </p>

        {sections.map((s) => (
          <Section key={s.title} title={s.title}>{s.body}</Section>
        ))}

        <footer style={footer}>
          <a href="/support" style={fnav}>{zh ? "支援" : "Support"}</a>
          <span style={dot}>·</span>
          <a href="/terms" style={fnav}>{zh ? "條款" : "Terms"}</a>
        </footer>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={section}>
      <h2 style={h2}>{title}</h2>
      {children}
    </section>
  );
}

const shell = { minHeight: "100vh", display: "flex", justifyContent: "center", padding: "48px 24px" } as const;
const card  = { maxWidth: 720, width: "100%", color: T.text, lineHeight: 1.65 } as const;
const h1    = { fontFamily: T.font.mono, fontSize: 28, marginBottom: 4 } as const;
const h2    = { fontFamily: T.font.mono, fontSize: 15, color: T.accent, marginBottom: 8, marginTop: 0 } as const;
const meta  = { fontSize: 11, color: T.mutedMid, marginBottom: 20 } as const;
const lead  = { fontSize: 14, color: T.muted, marginBottom: 28 } as const;
const section = { marginBottom: 26 } as const;
const body  = { fontSize: 13, color: T.muted, margin: "0 0 10px 0" } as const;
const list  = { fontSize: 13, color: T.muted, paddingLeft: 20, marginBottom: 10 } as const;
const code  = { fontFamily: T.font.mono, fontSize: 12, background: "rgba(0,0,0,0.25)", padding: "1px 5px", borderRadius: 4 } as const;
const link  = { color: T.accent, textDecoration: "none" } as const;
const footer = { display: "flex", gap: 10, fontSize: 12, color: T.muted, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${T.border}` } as const;
const fnav  = { color: T.muted, textDecoration: "none" } as const;
const dot   = { opacity: 0.4 } as const;
