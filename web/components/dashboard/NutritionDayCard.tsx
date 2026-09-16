"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";

export type NutritionDay = {
  day: string;
  // Nutritionist-style guidance (new format)
  workout_type?: string;
  pre_workout?: string;
  post_workout?: string;
  foods?: string[];
  targets?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
  why?: string;
  // Legacy meal plan format (fallback)
  meals?: Array<{ name: string; items: Array<{ food: string; grams: number; kcal: number }> }>;
  day_total?: { kcal: number; protein_g: number; carbs_g: number; fat_g: number };
};

export default function NutritionDayCard({ day }: { day: NutritionDay }) {
  const [open, setOpen] = useState(false);
  const isNewFormat = !!(day.pre_workout || day.post_workout || day.foods?.length);

  const summary = isNewFormat
    ? `${day.workout_type ?? "Training"} · ${day.targets?.kcal ?? "—"} kcal`
    : `${day.day_total?.kcal ?? "—"} kcal · P ${day.day_total?.protein_g ?? "—"}g · C ${day.day_total?.carbs_g ?? "—"}g`;

  return (
    <div style={{
      background: "rgba(0,0,0,0.18)",
      borderRadius: 10,
      borderLeft: `3px solid ${T.accent}`,
      overflow: "hidden",
    }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%", display: "flex", alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 14px", background: "transparent",
          border: "none", color: T.text, cursor: "pointer", textAlign: "left",
        }}
      >
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span style={{
            fontSize: 12, fontWeight: 700, letterSpacing: "0.08em",
            textTransform: "uppercase", minWidth: 36,
          }}>
            {day.day}
          </span>
          <span style={{ fontSize: 11, color: T.muted }}>{summary}</span>
        </div>
        <span style={{
          fontSize: 10, color: T.muted,
          display: "inline-block",
          transform: open ? "rotate(180deg)" : "none",
          transition: "transform 0.15s",
        }}>
          ▾
        </span>
      </button>

      {open && (
        <div style={{ padding: "0 14px 12px", display: "flex", flexDirection: "column", gap: 10 }}>
          {isNewFormat ? (
            <>
              {day.pre_workout && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 3 }}>
                    Pre-workout
                  </div>
                  <div style={{ fontSize: 12, color: T.mutedMid, lineHeight: 1.4 }}>{day.pre_workout}</div>
                </div>
              )}
              {day.post_workout && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.accent, marginBottom: 3 }}>
                    Post-workout
                  </div>
                  <div style={{ fontSize: 12, color: T.mutedMid, lineHeight: 1.4 }}>{day.post_workout}</div>
                </div>
              )}
              {day.foods && day.foods.length > 0 && (
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", textTransform: "uppercase", color: T.muted, marginBottom: 3 }}>
                    Foods today
                  </div>
                  <div style={{ fontSize: 12, color: T.mutedMid, lineHeight: 1.6 }}>
                    {day.foods.join(" · ")}
                  </div>
                </div>
              )}
              {day.targets && (
                <div style={{ display: "flex", gap: 14, fontSize: 11, color: T.muted, fontFamily: T.font.mono, flexWrap: "wrap" }}>
                  <span>{day.targets.kcal} kcal</span>
                  <span>P {day.targets.protein_g}g</span>
                  <span>C {day.targets.carbs_g}g</span>
                  <span>F {day.targets.fat_g}g</span>
                </div>
              )}
              {day.why && (
                <div style={{
                  fontSize: 11, color: T.muted, fontStyle: "italic",
                  borderTop: `1px dashed ${T.border}`, paddingTop: 8, lineHeight: 1.5,
                }}>
                  {day.why}
                </div>
              )}
            </>
          ) : (
            day.meals?.map((meal, mi) => (
              <div key={mi} style={{ borderTop: `1px dashed ${T.border}`, paddingTop: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: T.accent, marginBottom: 4 }}>
                  {meal.name}
                </div>
                {meal.items.map((it, ii) => (
                  <div key={ii} style={{
                    display: "flex", justifyContent: "space-between",
                    fontSize: 11, color: T.mutedMid, padding: "2px 0",
                  }}>
                    <span>{it.food}</span>
                    <span style={{ fontFamily: T.font.mono, color: T.muted }}>
                      {it.grams}g · {it.kcal} kcal
                    </span>
                  </div>
                ))}
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
