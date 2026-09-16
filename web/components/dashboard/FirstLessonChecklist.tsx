"use client";

import Link from "next/link";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { ScreeningRow } from "./ScreeningSummary";
import AlertActionForm from "./AlertActionForm";

type Props = {
  clientId: string;
  screening: ScreeningRow | null;
  trainingBlocked: boolean;
  hasFirstLesson: boolean;
};

// Derives "what to collect at the first session" from the screening row.
// Pure UI: the agent-side enforcement of the same rules lives in M18.
// Client component so it translates via useI18n() and flips instantly with the
// language toggle (no server round-trip).
export default function FirstLessonChecklist({
  clientId, screening, trainingBlocked, hasFirstLesson,
}: Props) {
  const { t } = useI18n();
  if (hasFirstLesson) {
    return (
      <div className="glass" style={card} data-testid="first-lesson-done">
        <SectionLabel>✅ {t("fl.doneTitle")}</SectionLabel>
        <div style={{ fontSize: 12, color: T.mutedMid, marginTop: 8 }}>
          {t("fl.doneBody")}
        </div>
        <Link href={`/clients/${clientId}/first-lesson`} style={btnLink}>
          {t("fl.reopen")}
        </Link>
      </div>
    );
  }

  const items: { label: string; emoji: string; required: boolean; note?: string }[] = [
    { label: t("fl.itemBp"), emoji: "🫀", required: true },
    { label: t("fl.itemInbody"), emoji: "⚖️", required: true },
    { label: t("fl.itemPostural"), emoji: "🧍", required: true },
    { label: t("fl.itemFms"), emoji: "🤸", required: true },
  ];

  if (screening?.medical_clearance_required) {
    items.push({
      label: t("fl.itemSkipMax"),
      emoji: "⚠️",
      required: true,
      note: t("fl.noteParq"),
    });
  } else {
    items.push({ label: t("fl.itemBattery"), emoji: "🏋️", required: true });
  }

  const beta = (screening?.medical_history as { beta_blockers?: boolean } | null | undefined)?.beta_blockers;
  if (beta) {
    items.push({
      label: t("fl.itemRpe"),
      emoji: "💓",
      required: true,
      note: t("fl.noteBeta"),
    });
  }

  return (
    <div className="glass" style={card} data-testid="first-lesson-checklist">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <SectionLabel>📋 {t("fl.checklistTitle")}</SectionLabel>
        <Link
          href={`/clients/${clientId}/first-lesson`}
          data-testid="open-first-lesson"
          style={{
            fontSize: 11,
            padding: "6px 12px",
            borderRadius: 99,
            background: "rgba(196,148,82,0.18)",
            color: "#e4c08c",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          {t("fl.startCapture")}
        </Link>
      </div>

      {trainingBlocked && (
        <div
          data-testid="training-blocked"
          style={{
            marginTop: 12,
            padding: "10px 12px",
            borderRadius: 8,
            background: "rgba(196, 86, 64, 0.22)",
            border: "1px solid rgba(196, 86, 64, 0.55)",
            color: "#fde2da",
            fontSize: 11,
            lineHeight: 1.5,
          }}
        >
          🚫 <strong>{t("fl.blockedTitle")}</strong> {t("fl.blockedBody")}
          <AlertActionForm
            clientId={clientId}
            endpoint="unblock"
            buttonLabel={t("fl.clearBlock")}
            successLabel={t("fl.unblock")}
            placeholder={t("fl.blockPlaceholder")}
            testId="clear-block"
          />
        </div>
      )}

      <ul style={{ marginTop: 14, padding: 0, listStyle: "none", fontSize: 12.5, color: T.mutedMid, lineHeight: 1.7 }}>
        {items.map((i, idx) => (
          <li key={idx} style={{ display: "flex", gap: 8, marginBottom: 4 }}>
            <span style={{ flexShrink: 0 }}>{i.emoji}</span>
            <span>
              {i.label}
              {i.note && (
                <span style={{ marginLeft: 8, fontSize: 10, color: "#fab9a9" }}>· {i.note}</span>
              )}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

const card: React.CSSProperties = { borderRadius: 14, padding: "18px 22px" };

const btnLink: React.CSSProperties = {
  fontSize: 11,
  marginTop: 10,
  display: "inline-block",
  color: T.accent,
  textDecoration: "none",
};

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.14em",
        textTransform: "uppercase",
        color: T.muted,
      }}
    >
      {children}
    </div>
  );
}
