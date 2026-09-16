"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import { AFT_LEVELS, type AftLevel } from "@/lib/exercise-library";

type Props = {
  selected: Set<AftLevel>;
  onToggle: (lv: AftLevel) => void;
  onClear: () => void;
  // The in-context client's classified level, to mark "their" level here too.
  clientLevel: AftLevel | null;
};

// The AFT Enhancement System level filter + explainer. Each card is a multi-select
// toggle — click several to combine. Lives in the Programme filter card.
export default function AftFilter({ selected, onToggle, onClear, clientLevel }: Props) {
  const { t, locale } = useI18n();
  const lang = (l: { en: string; zh: string }) => (locale === "zh" ? l.zh : l.en);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase", color: "#e4c08c" }}>
          {t("aft.filterLabel")}
        </span>
        <span style={{ fontSize: 10, color: T.muted }}>{t("aft.filterMulti")}</span>
        {selected.size > 0 && (
          <button onClick={onClear} data-testid="aft-filter-clear"
            style={{ marginLeft: "auto", fontSize: 10, color: T.mutedMid, background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>
            {t("aft.clear")}
          </button>
        )}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 8 }}>
        {AFT_LEVELS.map((lv) => {
          const on = selected.has(lv.key);
          const isClient = clientLevel === lv.key;
          return (
            <button
              key={lv.key}
              onClick={() => onToggle(lv.key)}
              data-testid={`aft-level-${lv.key}`}
              aria-pressed={on}
              title={lang(lv.blurb)}
              style={{
                textAlign: "left", cursor: "pointer", borderRadius: 10, padding: "8px 10px",
                background: on ? `${lv.color}22` : "rgba(0,0,0,0.25)",
                border: `1px solid ${on ? lv.color : isClient ? `${lv.color}88` : T.border}`,
                outline: isClient ? `2px solid ${lv.color}44` : "none",
                display: "flex", flexDirection: "column", gap: 3,
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ width: 11, height: 11, borderRadius: 99, background: lv.color, flexShrink: 0, opacity: on ? 1 : 0.6 }} />
                <span style={{ fontSize: 11.5, fontWeight: 700, color: on ? T.text : T.mutedMid }}>{lang(lv.label)}</span>
                {on && <span style={{ marginLeft: "auto", fontSize: 10, color: lv.color }}>✓</span>}
                {isClient && <span style={{ fontSize: 9, fontWeight: 700, color: lv.color }}>● {t("aft.thisClient")}</span>}
              </div>
              <div style={{ fontSize: 10, fontWeight: 600, color: lv.color }}>{lang(lv.who)}</div>
              <div style={{ fontSize: 9.5, color: T.mutedMid, lineHeight: 1.4 }}>{lang(lv.blurb)}</div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
