"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import type { ClientView } from "@/lib/types";
import AftBadge from "@/components/programme/AftBadge";
import StatusBadge from "./StatusBadge";

export default function ClientTable({ clients, showViewAll = true }: { clients: ClientView[]; showViewAll?: boolean }) {
  const router = useRouter();
  const [hovered, setHovered] = useState<string | null>(null);
  const { t } = useI18n();
  const headers: Array<[key: string, label: string]> = [
    ["name", t("table.name")],
    ["goal", t("table.goal")],
    ["aft", t("table.aft")],
    ["lastSession", t("table.lastSession")],
    ["strava", t("table.strava")],
    ["status", t("table.status")],
  ];
  const GRID = "1fr 1fr 78px 100px 52px 80px";
  return (
    <div className="glass" style={{ borderRadius: T.radius.card, padding: "22px 0", display: "flex", flexDirection: "column" }}>
      <div style={{ padding: "0 24px 14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 13, fontWeight: 600 }}>{t("table.clients")}</div>
        {showViewAll && (
          <span onClick={() => router.push("/clients")} style={{ fontSize: 11, color: T.accent, cursor: "pointer" }}>{t("table.viewAll")}</span>
        )}
      </div>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: GRID,
          padding: "0 24px 8px",
          gap: 8,
        }}
      >
        {headers.map(([key, label]) => (
          <span
            key={key}
            style={{
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              color: T.muted,
            }}
          >
            {label}
          </span>
        ))}
      </div>

      {clients.length === 0 && (
        <div data-testid="client-empty" style={{ padding: "16px 24px", fontSize: 12, color: T.muted }}>
          {t("table.emptyPre")} <strong style={{ color: T.accent }}>{t("topbar.addClient")}</strong> {t("table.emptyPost")}
        </div>
      )}

      {clients.map((c) => (
        <div
          key={c.id}
          data-testid="client-row"
          onMouseEnter={() => setHovered(c.id)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => router.push(`/clients/${c.id}`)}
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr 100px 52px 80px",
            padding: "10px 24px",
            gap: 8,
            alignItems: "center",
            background: hovered === c.id ? "rgba(255,255,255,0.03)" : "transparent",
            cursor: "pointer",
            transition: "background 0.12s",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
            <div
              style={{
                width: 26,
                height: 26,
                borderRadius: "50%",
                background: T.gradients.sage,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: 10,
                fontWeight: 700,
                flexShrink: 0,
              }}
            >
              {c.name.split(" ").map((n) => n[0]).join("")}
            </div>
            <span
              style={{
                fontSize: 12.5,
                fontWeight: 500,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {c.name}
            </span>
          </div>
          <span style={{ fontSize: 11.5, color: T.mutedMid }}>{c.goal}</span>
          <span style={{ display: "flex", alignItems: "center" }}>
            {c.aftLevel ? <AftBadge level={c.aftLevel} size="sm" /> : <span style={{ fontSize: 11, color: T.muted }}>—</span>}
          </span>
          <span style={{ fontSize: 11, color: T.muted }}>{c.lastSession}</span>
          <span style={{ display: "flex", alignItems: "center" }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                background: c.strava ? "#22c55e" : "#444",
                boxShadow: c.strava ? "0 0 6px #22c55e" : "none",
              }}
            />
          </span>
          <StatusBadge status={c.status} />
        </div>
      ))}
    </div>
  );
}
