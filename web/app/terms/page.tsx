import { T } from "@/lib/design-tokens";
import { getLocale } from "@/lib/i18n-server";
import PublicLangToggle from "@/components/PublicLangToggle";

export const metadata = {
  title: "Terms of Service — gymDays",
  description: "Terms of use for the gymDays coaching platform.",
};

const SUPPORT_EMAIL = "tobywong42r@outlook.com";
const EFFECTIVE = "2026-05-31";

export default async function TermsPage() {
  const zh = (await getLocale()) === "zh";
  const email = <a href={`mailto:${SUPPORT_EMAIL}`} style={link}>{SUPPORT_EMAIL}</a>;

  const sections: Array<{ title: string; body: React.ReactNode }> = zh ? [
    { title: "1. 誰可以使用本服務", body: <>
      <p style={body}><strong>教練</strong>：你必須年滿 18 歲，並使用本服務提供正當的個人訓練服務。</p>
      <p style={body}><strong>客戶</strong>：你必須年滿 16 歲。若未滿 18 歲，須由你的父母或監護人同意你的教練代表你使用本服務。</p>
    </> },
    { title: "2. 可接受的使用", body: <p style={body}>你同意不得：(a) 濫用本服務，(b) 嘗試逆向工程或擷取你無權存取的資料，(c) 上傳違法、騷擾或侵權的內容，(d) 利用本服務冒充他人，(e) 干擾其他使用者或本服務的基礎設施。</p> },
    { title: "3. 健康與訓練免責聲明", body: <p style={body}>gymDays 是供個人教練使用的生產力工具。<strong>AI 產生的訓練課表、營養建議與進度評估並非醫療建議。</strong>開始任何新的訓練或營養計畫前，請務必諮詢合格的醫療專業人員。你須為自己訓練時的安全負責。</p> },
    { title: "4. 第三方服務", body: <>
      <p style={body}>本服務整合 Strava、Telegram 與 AI 推論供應商（Anthropic、OpenAI）。你使用這些服務受其各自的條款規範。我們不對這些第三方服務的中斷或變更負責。</p>
      <p style={body}>本服務中顯示的 Strava 活動資料由 Strava 提供，並持續受 <a href="https://www.strava.com/legal/api" target="_blank" rel="noreferrer" style={link}>Strava API 協議</a>規範。</p>
    </> },
    { title: "5. 你的內容", body: <p style={body}>你保有所提交資料（個人資訊、活動資料、訊息）的所有權。你授予 gymDays 非專屬授權，僅為你與你的教練營運本服務而處理這些資料。我們不會為任何其他目的販售、授權或使用你的資料。</p> },
    { title: "6. 隱私", body: <p style={body}>我們如何處理資料載於我們的<a href="/privacy" style={link}>隱私權政策</a>，該政策納入本條款之一部分。</p> },
    { title: "7. 終止", body: <>
      <p style={body}>你可隨時停止使用本服務。教練可寄信至 {email} 關閉帳號。客戶可請教練將其移除，或直接與我們聯絡。終止後，我們會於 30 天內刪除相關資料。</p>
      <p style={body}>對於違反本條款的帳號，我們得暫停或終止，並在合理情況下提供通知。</p>
    </> },
    { title: "8. 保固免責聲明", body: <p style={body}>本服務以「現狀」提供，不提供任何明示或默示的保證，包括適售性、特定用途之適用性與非侵權。AI 輸出可能不準確、不完整或過時 — 請運用專業判斷。</p> },
    { title: "9. 責任限制", body: <p style={body}>在法律允許的最大範圍內，gymDays 不就間接、附帶、衍生或懲罰性損害，或利潤、資料或訓練成果之損失負責。我們就因本服務引起之任何請求的總責任，以你在請求前 12 個月內支付給我們的金額為限（可能為零）。</p> },
    { title: "10. 本條款的變更", body: <p style={body}>我們得更新本條款。重大變更將以電子郵件或應用程式內通知告知。生效日期後繼續使用即表示接受。</p> },
    { title: "11. 聯絡", body: <p style={body}>{email}</p> },
  ] : [
    { title: "1. Who can use the Service", body: <>
      <p style={body}><strong>Trainers</strong>: you must be at least 18 years old and use the Service to provide legitimate personal-training services.</p>
      <p style={body}><strong>Clients</strong>: you must be at least 16 years old. If under 18, your parent or guardian must consent to your trainer using the Service on your behalf.</p>
    </> },
    { title: "2. Acceptable use", body: <p style={body}>You agree not to: (a) misuse the Service, (b) attempt to reverse-engineer or scrape data you are not authorized to access, (c) upload content that is unlawful, harassing, or infringing, (d) use the Service to impersonate another person, (e) interfere with other users or the Service infrastructure.</p> },
    { title: "3. Health and training disclaimer", body: <p style={body}>gymDays is a productivity tool for personal trainers. <strong>AI-generated workout plans, nutrition suggestions, and progress assessments are not medical advice.</strong> Always consult a qualified healthcare professional before starting a new training or nutrition program. You are responsible for your own safety while training.</p> },
    { title: "4. Third-party services", body: <>
      <p style={body}>The Service integrates with Strava, Telegram, and AI inference providers (Anthropic, OpenAI). Your use of those services is governed by their own terms. We are not responsible for outages or changes to those third-party services.</p>
      <p style={body}>Strava activity data shown in the Service is provided by Strava and remains subject to <a href="https://www.strava.com/legal/api" target="_blank" rel="noreferrer" style={link}>Strava's API Agreement</a>.</p>
    </> },
    { title: "5. Your content", body: <p style={body}>You retain ownership of data you submit (profile info, activity data, messages). You grant gymDays a non-exclusive license to process this data solely to operate the Service for you and your trainer. We will not sell, license, or use your data for any other purpose.</p> },
    { title: "6. Privacy", body: <p style={body}>How we handle data is described in our <a href="/privacy" style={link}>Privacy Policy</a>, which is incorporated into these Terms.</p> },
    { title: "7. Termination", body: <>
      <p style={body}>You may stop using the Service at any time. Trainers can close their account by emailing {email}. Clients can ask their trainer to remove them, or contact us directly. On termination we will delete linked data within 30 days.</p>
      <p style={body}>We may suspend or terminate accounts that violate these Terms, with notice where reasonable.</p>
    </> },
    { title: "8. Warranty disclaimer", body: <p style={body}>The Service is provided "as is" without warranties of any kind, express or implied, including merchantability, fitness for a particular purpose, and non-infringement. AI outputs may be inaccurate, incomplete, or out of date — use professional judgment.</p> },
    { title: "9. Limitation of liability", body: <p style={body}>To the maximum extent permitted by law, gymDays will not be liable for indirect, incidental, consequential, or punitive damages, or for loss of profits, data, or training outcomes. Our aggregate liability for any claim arising out of the Service is limited to the amounts you paid us in the 12 months prior to the claim (which may be zero).</p> },
    { title: "10. Changes to these Terms", body: <p style={body}>We may update these Terms. Material changes will be communicated by email or in-app notice. Continued use after the effective date constitutes acceptance.</p> },
    { title: "11. Contact", body: <p style={body}>{email}</p> },
  ];

  return (
    <div style={shell}>
      <PublicLangToggle />
      <div style={card}>
        <h1 style={h1}>{zh ? "服務條款" : "Terms of Service"}</h1>
        <p style={meta}>{zh ? "生效日期" : "Effective"} {EFFECTIVE}</p>

        <p style={lead}>
          {zh
            ? "本條款規範你對 gymDays（「本服務」）的使用。建立帳號、接受教練邀請或透過本服務連結你的 Strava 帳號，即表示你同意本條款。"
            : "These Terms govern your use of gymDays (\"the Service\"). By creating an account, accepting a coaching invitation, or connecting your Strava account through the Service, you agree to these Terms."}
        </p>

        {sections.map((s) => (
          <Section key={s.title} title={s.title}>{s.body}</Section>
        ))}

        <footer style={footer}>
          <a href="/support" style={fnav}>{zh ? "支援" : "Support"}</a>
          <span style={dot}>·</span>
          <a href="/privacy" style={fnav}>{zh ? "隱私權" : "Privacy"}</a>
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
const link  = { color: T.accent, textDecoration: "none" } as const;
const footer = { display: "flex", gap: 10, fontSize: 12, color: T.muted, marginTop: 24, paddingTop: 16, borderTop: `1px solid ${T.border}` } as const;
const fnav  = { color: T.muted, textDecoration: "none" } as const;
const dot   = { opacity: 0.4 } as const;
