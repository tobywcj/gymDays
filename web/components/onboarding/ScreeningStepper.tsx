"use client";

import { useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";

type Lang = "en" | "zh";

type ParqAnswers = {
  heart_condition: boolean | null;
  chest_pain_activity: boolean | null;
  chest_pain_rest: boolean | null;
  dizziness: boolean | null;
  bone_joint: boolean | null;
  blood_pressure_med: boolean | null;
  other_reason: boolean | null;
  free_text: string;
};

type MedicalHistory = {
  previous_injuries: string;
  medications: string;
  beta_blockers: boolean;
  chronic: {
    hypertension: boolean;
    diabetes: boolean;
    anemia: boolean;
    asthma: boolean;
  };
  notes: string;
};

type CvdRisk = {
  age: string;
  sex: "m" | "f" | "";
  family_history: boolean;
  smoking: boolean;
  inactivity: boolean;
  obesity: boolean;
};

type Props = {
  token: string;
  clientName: string;
  trainerName: string | null;
};

const initialParq: ParqAnswers = {
  heart_condition: null,
  chest_pain_activity: null,
  chest_pain_rest: null,
  dizziness: null,
  bone_joint: null,
  blood_pressure_med: null,
  other_reason: null,
  free_text: "",
};

const initialMedical: MedicalHistory = {
  previous_injuries: "",
  medications: "",
  beta_blockers: false,
  chronic: { hypertension: false, diabetes: false, anemia: false, asthma: false },
  notes: "",
};

const initialCvd: CvdRisk = {
  age: "",
  sex: "",
  family_history: false,
  smoking: false,
  inactivity: false,
  obesity: false,
};

// Bilingual copy. EN/ZH side-by-side mirrors the source PAR-Q document.
const COPY = {
  title: { en: "Pre-training Screening", zh: "訓練前篩查問卷" },
  step: { en: "Step", zh: "步驟" },
  of: { en: "of", zh: "/" },
  back: { en: "Back", zh: "返回" },
  next: { en: "Next", zh: "下一步" },
  finish: { en: "Create account & submit", zh: "建立帳戶並提交" },
  yes: { en: "Yes", zh: "是" },
  no: { en: "No", zh: "否" },

  step1Title: { en: "Part 1 · PAR-Q", zh: "第一部分 · 體適能與你問卷" },
  step1Sub: {
    en: "Answer honestly — your safety is the only goal of this section.",
    zh: "請如實作答 — 此部分的目的是確保您的訓練安全。",
  },
  parq: {
    heart_condition: {
      en: "Has a doctor ever said you have a heart condition?",
      zh: "醫生是否曾告訴您患有心臟問題？",
    },
    chest_pain_activity: {
      en: "Do you feel chest pain when you do physical activity?",
      zh: "做運動時您是否感到胸痛？",
    },
    chest_pain_rest: {
      en: "Have you had chest pain when not doing physical activity in the past month?",
      zh: "過去一個月內您在休息時是否感到胸痛？",
    },
    dizziness: {
      en: "Do you lose your balance because of dizziness or do you ever lose consciousness?",
      zh: "您是否曾因頭暈而失去平衡，或曾失去知覺？",
    },
    bone_joint: {
      en: "Do you have a bone or joint problem that could be made worse by exercise?",
      zh: "您是否有骨骼或關節問題，可能因運動而加劇？",
    },
    blood_pressure_med: {
      en: "Are you currently taking drugs for blood pressure or a heart condition?",
      zh: "您目前是否服用血壓或心臟病藥物？",
    },
    other_reason: {
      en: "Do you know of any other reason you should not do physical activity?",
      zh: "您是否知道任何其他不適合運動的原因？",
    },
  },
  freeTextLabel: {
    en: "Anything else we should know? (optional)",
    zh: "其他需要告知的事項？（選填）",
  },
  clearanceBanner: {
    en: "⚠️ You answered Yes to one or more PAR-Q questions. We strongly recommend obtaining medical clearance from your doctor before high-intensity training. Your trainer will still receive your screening.",
    zh: "⚠️ 您在 PAR-Q 問卷中有一項或以上回答「是」。我們強烈建議您在進行高強度訓練前先諮詢醫生意見。您的教練仍會收到此份篩查。",
  },

  step2Title: { en: "Part 2 · Medical & Injury History", zh: "第二部分 · 醫學傷病史" },
  step2Sub: {
    en: "Previous injuries, medications, and chronic conditions.",
    zh: "過往傷病、藥物與慢性病狀況。",
  },
  injuriesLabel: {
    en: "Previous injuries (one per line)",
    zh: "過往傷病紀錄（每行一項）",
  },
  injuriesPlaceholder: {
    en: "e.g. right knee meniscus 2022\nlower back strain 2024",
    zh: "例如：2022 右膝半月板\n2024 下背扭傷",
  },
  medsLabel: { en: "Current medications (one per line)", zh: "目前服用藥物（每行一項）" },
  medsPlaceholder: {
    en: "e.g. metformin 500mg\nlisinopril 10mg",
    zh: "例如：metformin 500mg\nlisinopril 10mg",
  },
  betaBlockers: {
    en: "I take beta-blockers (affects heart rate response)",
    zh: "我正在服用 Beta-blockers（影響心率反應）",
  },
  chronicLabel: { en: "Chronic conditions", zh: "慢性疾病狀況" },
  hypertension: { en: "Hypertension", zh: "高血壓" },
  diabetes: { en: "Diabetes", zh: "糖尿病" },
  anemia: { en: "Anemia", zh: "貧血" },
  asthma: { en: "Asthma", zh: "哮喘" },
  notesLabel: { en: "Notes (optional)", zh: "備註（選填）" },

  step3Title: { en: "Part 3 · CVD Risk Factors", zh: "第三部分 · 心血管疾病風險" },
  step3Sub: {
    en: "Quick screen for cardiovascular risk — used to choose the safest tests for your first session.",
    zh: "心血管風險快速評估 — 用於為您的首次訓練選擇最安全的測試。",
  },
  ageLabel: { en: "Age", zh: "年齡" },
  sexLabel: { en: "Sex (for age-based risk thresholds)", zh: "性別（用於年齡風險閾值）" },
  male: { en: "Male", zh: "男" },
  female: { en: "Female", zh: "女" },
  familyHistory: {
    en: "Family history of early heart disease (1st-degree relative)",
    zh: "近親（一等親）有早發性心臟病",
  },
  smoking: { en: "Current smoker (or quit within 6 months)", zh: "目前吸煙（或六個月內戒煙）" },
  inactivity: {
    en: "Physically inactive (< 3 sessions of 30 min moderate exercise per week)",
    zh: "缺乏體力活動（每週少於 3 次 30 分鐘中強度運動）",
  },
  obesity: {
    en: "Overweight (BMI ≥ 25 or large waist circumference)",
    zh: "體重過重（BMI ≥ 25 或腰圍過大）",
  },

  step4Title: { en: "Part 4 · Create your account", zh: "第四部分 · 建立您的帳戶" },
  step4Sub: {
    en: "We'll link your screening to a new account so you can check in, track progress, and chat with your trainer.",
    zh: "我們會將您的篩查連結至新帳戶，方便您打卡、追蹤進度，並與教練對話。",
  },
  emailLabel: { en: "Email", zh: "電郵" },
  passwordLabel: {
    en: "Password (8+ characters)",
    zh: "密碼（至少 8 個字元）",
  },

  step5Title: { en: "All done!", zh: "完成！" },
  step5Sub: {
    en: "Your trainer has been notified. Bring this checklist to your first session.",
    zh: "您的教練已收到通知。請將此清單帶到您的首次訓練。",
  },
  checklistTitle: { en: "First-session checklist", zh: "首次訓練清單" },
  checklistAlways: {
    en: "Resting blood pressure + heart rate (5 min seated rest beforehand)",
    zh: "靜態血壓 + 心率（量測前先靜坐 5 分鐘）",
  },
  checklistInBody: {
    en: "InBody / BIA: weight, BMI, body fat %, fat-free mass, BMR, waist-hip ratio, total body water",
    zh: "InBody / BIA：體重、BMI、體脂率、瘦體重、基礎代謝率、腰臀比、身體水份",
  },
  checklistPostural: {
    en: "Postural & functional movement screen (Overhead Squat, Hip Hinge, Single-leg Squat, Wall Angel)",
    zh: "姿勢及功能動作分析（過頭深蹲、髖鉸鏈、單腳半蹲、牆上天使）",
  },
  checklistClearance: {
    en: "⚠️ Bring medical clearance — you answered Yes to PAR-Q.",
    zh: "⚠️ 請帶備醫生清介證明 — 您 PAR-Q 中有「是」回答。",
  },
};

function t(key: keyof typeof COPY, lang: Lang): string {
  return (COPY[key] as Record<Lang, string>)[lang];
}

export default function ScreeningStepper({ token, clientName, trainerName }: Props) {
  const { locale: lang, setLocale } = useI18n();
  const [step, setStep] = useState(1);
  const [parq, setParq] = useState<ParqAnswers>(initialParq);
  const [medical, setMedical] = useState<MedicalHistory>(initialMedical);
  const [cvd, setCvd] = useState<CvdRisk>(initialCvd);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parqYes = Object.entries(parq).some(
    ([k, v]) => k !== "free_text" && v === true,
  );
  const parqAllAnswered = (Object.entries(parq) as [keyof ParqAnswers, unknown][])
    .filter(([k]) => k !== "free_text")
    .every(([, v]) => v !== null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const supabase = supabaseBrowser();
      const { data: signup, error: suErr } = await supabase.auth.signUp({
        email,
        password,
      });
      if (suErr) throw suErr;
      const authUserId = signup.user?.id;
      if (!authUserId) throw new Error("No user id returned from signup.");

      const { error: rpcErr } = await supabase.rpc("invite_submit_screening", {
        p_token: token,
        p_screening: {
          email,
          parq: {
            heart_condition: parq.heart_condition === true,
            chest_pain_activity: parq.chest_pain_activity === true,
            chest_pain_rest: parq.chest_pain_rest === true,
            dizziness: parq.dizziness === true,
            bone_joint: parq.bone_joint === true,
            blood_pressure_med: parq.blood_pressure_med === true,
            other_reason: parq.other_reason === true,
            free_text: parq.free_text,
          },
          medical_history: {
            previous_injuries: medical.previous_injuries.split("\n").map((s) => s.trim()).filter(Boolean),
            medications: medical.medications.split("\n").map((s) => s.trim()).filter(Boolean),
            beta_blockers: medical.beta_blockers,
            chronic: medical.chronic,
            notes: medical.notes,
          },
          cvd_risk: {
            age: cvd.age ? parseInt(cvd.age, 10) : null,
            sex: cvd.sex || null,
            family_history: cvd.family_history,
            smoking: cvd.smoking,
            inactivity: cvd.inactivity,
            obesity: cvd.obesity,
          },
        },
        p_auth_user_id: authUserId,
        p_language: lang,
      });
      if (rpcErr) throw rpcErr;
      setStep(5);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="glass glass-tint-moss"
      style={{
        borderRadius: T.radius.card,
        padding: 28,
        maxWidth: 620,
        width: "100%",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <Header
        clientName={clientName}
        trainerName={trainerName}
        step={step}
        lang={lang}
        onToggleLang={() => setLocale(lang === "en" ? "zh" : "en")}
      />

      {step === 1 && (
        <Step1Parq parq={parq} setParq={setParq} parqYes={parqYes} lang={lang} />
      )}
      {step === 2 && <Step2Medical medical={medical} setMedical={setMedical} lang={lang} />}
      {step === 3 && <Step3Cvd cvd={cvd} setCvd={setCvd} lang={lang} />}
      {step === 4 && (
        <Step4Signup
          email={email}
          setEmail={setEmail}
          password={password}
          setPassword={setPassword}
          parqYes={parqYes}
          lang={lang}
        />
      )}
      {step === 5 && (
        <Step5Confirm parqYes={parqYes} lang={lang} />
      )}

      {error && (
        <div data-testid="submit-error" style={{ color: "#f87171", fontSize: 12 }}>
          {error}
        </div>
      )}

      {step < 5 && (
        <div style={{ display: "flex", gap: 8, justifyContent: "space-between" }}>
          <button
            type="button"
            onClick={() => setStep(Math.max(1, step - 1))}
            disabled={step === 1}
            style={ghostBtn(step === 1)}
          >
            ← {t("back", lang)}
          </button>
          {step < 4 ? (
            <button
              type="button"
              data-testid={`step-next-${step}`}
              onClick={() => setStep(step + 1)}
              disabled={step === 1 && !parqAllAnswered}
              style={primaryBtn(step === 1 && !parqAllAnswered)}
            >
              {t("next", lang)} →
            </button>
          ) : (
            <button
              type="button"
              data-testid="submit-final"
              onClick={submit}
              disabled={submitting || !email || password.length < 8}
              style={primaryBtn(submitting || !email || password.length < 8)}
            >
              {submitting ? "…" : t("finish", lang)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function Header({
  clientName, trainerName, step, lang, onToggleLang,
}: {
  clientName: string;
  trainerName: string | null;
  step: number;
  lang: Lang;
  onToggleLang: () => void;
}) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div>
          <div style={{ fontFamily: T.font.mono, fontSize: 22 }}>
            {lang === "zh" ? `您好，${clientName}` : `Welcome, ${clientName}`}
          </div>
          <div style={{ fontSize: 11, color: T.muted, marginTop: 4 }}>
            {trainerName
              ? lang === "zh"
                ? `${trainerName} 邀請您完成訓練前篩查。`
                : `${trainerName} sent you this screening.`
              : lang === "zh"
                ? "您的教練邀請您完成訓練前篩查。"
                : "Your trainer sent you this screening."}
          </div>
        </div>
        <button
          type="button"
          onClick={onToggleLang}
          data-testid="lang-toggle"
          style={{
            fontSize: 10,
            padding: "4px 10px",
            borderRadius: 99,
            border: `1px solid ${T.border}`,
            background: "transparent",
            color: T.mutedMid,
            cursor: "pointer",
          }}
        >
          {lang === "zh" ? "EN" : "中文"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 4, marginTop: 12 }}>
        {[1, 2, 3, 4, 5].map((n) => (
          <div
            key={n}
            style={{
              flex: 1,
              height: 3,
              borderRadius: 2,
              background: n <= step ? T.accent : T.border,
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, color: T.muted, marginTop: 6 }}>
        {t("step", lang)} {step} {t("of", lang)} 5
      </div>
    </div>
  );
}

function Step1Parq({
  parq, setParq, parqYes, lang,
}: {
  parq: ParqAnswers;
  setParq: (p: ParqAnswers) => void;
  parqYes: boolean;
  lang: Lang;
}) {
  const items: Array<keyof typeof COPY.parq> = [
    "heart_condition", "chest_pain_activity", "chest_pain_rest",
    "dizziness", "bone_joint", "blood_pressure_med", "other_reason",
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionTitle title={COPY.step1Title[lang]} sub={COPY.step1Sub[lang]} />
      {items.map((key) => (
        <YesNoRow
          key={key}
          testId={`parq-${key}`}
          label={COPY.parq[key][lang]}
          value={parq[key] as boolean | null}
          yesLabel={COPY.yes[lang]}
          noLabel={COPY.no[lang]}
          onChange={(v) => setParq({ ...parq, [key]: v })}
        />
      ))}
      <FieldLabel label={COPY.freeTextLabel[lang]}>
        <textarea
          rows={2}
          data-testid="parq-free-text"
          value={parq.free_text}
          onChange={(e) => setParq({ ...parq, free_text: e.target.value })}
          style={inputStyle}
        />
      </FieldLabel>
      {parqYes && (
        <div
          data-testid="clearance-banner"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(196, 86, 64, 0.18)",
            border: "1px solid rgba(196, 86, 64, 0.45)",
            color: "#fde2da",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {COPY.clearanceBanner[lang]}
        </div>
      )}
    </div>
  );
}

function Step2Medical({
  medical, setMedical, lang,
}: {
  medical: MedicalHistory;
  setMedical: (m: MedicalHistory) => void;
  lang: Lang;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionTitle title={COPY.step2Title[lang]} sub={COPY.step2Sub[lang]} />

      <FieldLabel label={COPY.injuriesLabel[lang]}>
        <textarea
          rows={3}
          data-testid="medical-injuries"
          value={medical.previous_injuries}
          onChange={(e) => setMedical({ ...medical, previous_injuries: e.target.value })}
          placeholder={COPY.injuriesPlaceholder[lang]}
          style={inputStyle}
        />
      </FieldLabel>

      <FieldLabel label={COPY.medsLabel[lang]}>
        <textarea
          rows={3}
          data-testid="medical-meds"
          value={medical.medications}
          onChange={(e) => setMedical({ ...medical, medications: e.target.value })}
          placeholder={COPY.medsPlaceholder[lang]}
          style={inputStyle}
        />
      </FieldLabel>

      <Checkbox
        testId="medical-beta-blockers"
        label={COPY.betaBlockers[lang]}
        checked={medical.beta_blockers}
        onChange={(v) => setMedical({ ...medical, beta_blockers: v })}
      />

      <div>
        <div style={{ fontSize: 11, color: T.muted, marginBottom: 6 }}>
          {COPY.chronicLabel[lang]}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          <Checkbox
            testId="chronic-hypertension"
            label={COPY.hypertension[lang]}
            checked={medical.chronic.hypertension}
            onChange={(v) => setMedical({ ...medical, chronic: { ...medical.chronic, hypertension: v } })}
          />
          <Checkbox
            testId="chronic-diabetes"
            label={COPY.diabetes[lang]}
            checked={medical.chronic.diabetes}
            onChange={(v) => setMedical({ ...medical, chronic: { ...medical.chronic, diabetes: v } })}
          />
          <Checkbox
            testId="chronic-anemia"
            label={COPY.anemia[lang]}
            checked={medical.chronic.anemia}
            onChange={(v) => setMedical({ ...medical, chronic: { ...medical.chronic, anemia: v } })}
          />
          <Checkbox
            testId="chronic-asthma"
            label={COPY.asthma[lang]}
            checked={medical.chronic.asthma}
            onChange={(v) => setMedical({ ...medical, chronic: { ...medical.chronic, asthma: v } })}
          />
        </div>
      </div>

      <FieldLabel label={COPY.notesLabel[lang]}>
        <textarea
          rows={2}
          data-testid="medical-notes"
          value={medical.notes}
          onChange={(e) => setMedical({ ...medical, notes: e.target.value })}
          style={inputStyle}
        />
      </FieldLabel>
    </div>
  );
}

function Step3Cvd({
  cvd, setCvd, lang,
}: {
  cvd: CvdRisk;
  setCvd: (c: CvdRisk) => void;
  lang: Lang;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionTitle title={COPY.step3Title[lang]} sub={COPY.step3Sub[lang]} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <FieldLabel label={COPY.ageLabel[lang]}>
          <input
            type="number"
            min="10"
            max="100"
            data-testid="cvd-age"
            value={cvd.age}
            onChange={(e) => setCvd({ ...cvd, age: e.target.value })}
            style={inputStyle}
          />
        </FieldLabel>
        <FieldLabel label={COPY.sexLabel[lang]}>
          <div style={{ display: "flex", gap: 6, marginTop: 2 }}>
            {(["m", "f"] as const).map((s) => (
              <button
                key={s}
                type="button"
                data-testid={`cvd-sex-${s}`}
                onClick={() => setCvd({ ...cvd, sex: s })}
                style={{
                  flex: 1,
                  padding: "8px 10px",
                  borderRadius: 8,
                  border: `1px solid ${cvd.sex === s ? T.accent : T.border}`,
                  background: cvd.sex === s ? "rgba(98,132,88,0.25)" : "transparent",
                  color: T.text,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                {s === "m" ? COPY.male[lang] : COPY.female[lang]}
              </button>
            ))}
          </div>
        </FieldLabel>
      </div>

      <Checkbox
        testId="cvd-family-history"
        label={COPY.familyHistory[lang]}
        checked={cvd.family_history}
        onChange={(v) => setCvd({ ...cvd, family_history: v })}
      />
      <Checkbox
        testId="cvd-smoking"
        label={COPY.smoking[lang]}
        checked={cvd.smoking}
        onChange={(v) => setCvd({ ...cvd, smoking: v })}
      />
      <Checkbox
        testId="cvd-inactivity"
        label={COPY.inactivity[lang]}
        checked={cvd.inactivity}
        onChange={(v) => setCvd({ ...cvd, inactivity: v })}
      />
      <Checkbox
        testId="cvd-obesity"
        label={COPY.obesity[lang]}
        checked={cvd.obesity}
        onChange={(v) => setCvd({ ...cvd, obesity: v })}
      />
    </div>
  );
}

function Step4Signup({
  email, setEmail, password, setPassword, parqYes, lang,
}: {
  email: string;
  setEmail: (s: string) => void;
  password: string;
  setPassword: (s: string) => void;
  parqYes: boolean;
  lang: Lang;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionTitle title={COPY.step4Title[lang]} sub={COPY.step4Sub[lang]} />

      <FieldLabel label={COPY.emailLabel[lang]}>
        <input
          type="email"
          required
          data-testid="signup-email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          style={inputStyle}
        />
      </FieldLabel>

      <FieldLabel label={COPY.passwordLabel[lang]}>
        <input
          type="password"
          required
          minLength={8}
          data-testid="signup-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          style={inputStyle}
        />
      </FieldLabel>

      {parqYes && (
        <div
          data-testid="clearance-reminder"
          style={{
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(196, 86, 64, 0.18)",
            border: "1px solid rgba(196, 86, 64, 0.45)",
            color: "#fde2da",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          {COPY.clearanceBanner[lang]}
        </div>
      )}
    </div>
  );
}

function Step5Confirm({ parqYes, lang }: { parqYes: boolean; lang: Lang }) {
  return (
    <div data-testid="confirm-step" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <SectionTitle title={COPY.step5Title[lang]} sub={COPY.step5Sub[lang]} />
      <div
        style={{
          padding: "14px 16px",
          borderRadius: 12,
          background: "rgba(98,132,88,0.18)",
          border: "1px solid rgba(98,132,88,0.45)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        <div style={{ fontSize: 12, fontWeight: 600 }}>
          {COPY.checklistTitle[lang]}
        </div>
        <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 1.6, color: T.mutedMid }}>
          <li>{COPY.checklistAlways[lang]}</li>
          <li>{COPY.checklistInBody[lang]}</li>
          <li>{COPY.checklistPostural[lang]}</li>
          {parqYes && <li style={{ color: "#fde2da" }}>{COPY.checklistClearance[lang]}</li>}
        </ul>
      </div>
    </div>
  );
}

// ─── Reusable primitives ───────────────────────────────────────────────────

const inputStyle: React.CSSProperties = {
  background: "rgba(0,0,0,0.25)",
  border: `1px solid ${T.border}`,
  borderRadius: 8,
  padding: "10px 12px",
  color: T.text,
  fontFamily: T.font.sans,
  fontSize: 13,
  outline: "none",
  width: "100%",
};

function FieldLabel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 11, color: T.muted }}>
      {label}
      {children}
    </label>
  );
}

function SectionTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 700, color: T.text }}>{title}</div>
      <div style={{ fontSize: 11, color: T.muted, marginTop: 2 }}>{sub}</div>
    </div>
  );
}

function YesNoRow({
  label, value, onChange, yesLabel, noLabel, testId,
}: {
  label: string;
  value: boolean | null;
  onChange: (v: boolean) => void;
  yesLabel: string;
  noLabel: string;
  testId: string;
}) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
      <div style={{ fontSize: 12, color: T.text, flex: 1 }}>{label}</div>
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          data-testid={`${testId}-yes`}
          onClick={() => onChange(true)}
          style={pillBtn(value === true, "#c45640")}
        >
          {yesLabel}
        </button>
        <button
          type="button"
          data-testid={`${testId}-no`}
          onClick={() => onChange(false)}
          style={pillBtn(value === false, "#628458")}
        >
          {noLabel}
        </button>
      </div>
    </div>
  );
}

function Checkbox({
  label, checked, onChange, testId,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId: string;
}) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: T.text, cursor: "pointer" }}>
      <input
        type="checkbox"
        data-testid={testId}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ accentColor: T.accent }}
      />
      {label}
    </label>
  );
}

function pillBtn(active: boolean, color: string): React.CSSProperties {
  return {
    fontSize: 12,
    padding: "5px 16px",
    borderRadius: 99,
    border: `1px solid ${active ? color : T.border}`,
    background: active ? color : "transparent",
    color: active ? "#fffdf6" : T.mutedMid,
    cursor: "pointer",
    fontWeight: 600,
    minWidth: 56,
  };
}

function primaryBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "linear-gradient(135deg, rgba(98,132,88,0.95) 0%, rgba(58,82,52,0.95) 100%)",
    border: "1px solid rgba(255,252,245,0.25)",
    borderRadius: 99,
    padding: "9px 22px",
    color: "#fffdf6",
    fontSize: 13,
    fontWeight: 600,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.5 : 1,
    boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(58,82,52,0.45)",
  };
}

function ghostBtn(disabled: boolean): React.CSSProperties {
  return {
    background: "transparent",
    border: `1px solid ${T.border}`,
    borderRadius: 99,
    padding: "9px 18px",
    color: T.mutedMid,
    fontSize: 12,
    cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.4 : 1,
  };
}
