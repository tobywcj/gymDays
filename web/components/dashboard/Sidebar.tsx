"use client";

import { T } from "@/lib/design-tokens";
import { navItems } from "@/lib/mock";
import { navIconMap, SettingsIcon } from "./icons";
import BatMark from "@/components/BatMark";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useI18n } from "@/lib/i18n-context";
import type { Trainer } from "@/lib/types";

const NAV_ROUTES: Record<string, string> = {
  dashboard:  "/",
  clients:    "/clients",
  programme:  "/programme",
  knowledge:  "/knowledge",
  connections: "/connections",
};

type Props = {
  activeNav: string;
  setActiveNav: (id: string) => void;
  trainer: Trainer;
};

function initials(name: string | null, email: string): string {
  const source = name?.trim() || email.split("@")[0];
  const parts = source.split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function Sidebar({ activeNav, setActiveNav, trainer }: Props) {
  const [hover, setHover] = useState<string | null>(null);
  const router = useRouter();
  const { t } = useI18n();
  return (
    <div
      className="glass"
      style={{
        width: 220,
        minWidth: 220,
        borderRadius: 0,
        borderRight: `1px solid ${T.border}`,
        borderTop: "none",
        borderBottom: "none",
        borderLeft: "none",
        display: "flex",
        flexDirection: "column",
        padding: "28px 0 20px",
        gap: 0,
        height: "100%",
        position: "relative",
        background: "rgba(20, 26, 18, 0.35)",
      }}
    >
      {/* Logo */}
      <div style={{ padding: "0 22px 32px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
          <BatMark size={34} style={{ color: "#ffffff" }} />
          <span style={{ fontFamily: T.font.sans, fontWeight: 700, fontSize: 17, letterSpacing: "-0.02em" }}>
            Gym Days
          </span>
        </div>
      </div>

      {/* Nav */}
      <nav style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, padding: "0 12px" }}>
        {navItems.map((item) => {
          const active = activeNav === item.id;
          const Icon = navIconMap[item.id as keyof typeof navIconMap];
          const isHover = hover === item.id;
          return (
            <button
              key={item.id}
              onClick={() => {
                setActiveNav(item.id);
                if (NAV_ROUTES[item.id]) router.push(NAV_ROUTES[item.id]);
              }}
              onMouseEnter={() => setHover(item.id)}
              onMouseLeave={() => setHover(null)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "10px 12px",
                borderRadius: 10,
                background: active
                  ? "rgba(196,148,82,0.18)"
                  : isHover
                    ? "rgba(255,255,255,0.04)"
                    : "transparent",
                color: active ? "#e4c08c" : isHover ? "#fff" : T.mutedMid,
                border: "none",
                cursor: "pointer",
                width: "100%",
                textAlign: "left",
                fontFamily: T.font.sans,
                fontSize: 13.5,
                fontWeight: active ? 600 : 400,
                transition: "all 0.15s",
              }}
            >
              <span style={{ opacity: active ? 1 : 0.7, display: "flex" }}>
                <Icon />
              </span>
              {t(`nav.${item.id}`)}
              {item.id === "messages" && (
                <span
                  style={{
                    marginLeft: "auto",
                    background: "#c4946a",
                    color: "#1c2418",
                    borderRadius: 99,
                    padding: "1px 7px",
                    fontSize: 10,
                    fontWeight: 700,
                  }}
                >
                  4
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* Quick links above trainer */}
      <div style={{ padding: "8px 12px 4px", display: "flex", flexDirection: "column", gap: 2 }}>
        <a
          href="/connections"
          data-testid="nav-connections"
          style={{
            display: "block",
            padding: "8px 12px",
            borderRadius: 10,
            color: T.mutedMid,
            fontFamily: T.font.sans,
            fontSize: 12.5,
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.mutedMid; }}
        >
          {t("nav.connections")}
        </a>
        <a
          href="/api-keys"
          data-testid="nav-api-keys"
          style={{
            display: "block",
            padding: "8px 12px",
            borderRadius: 10,
            color: T.mutedMid,
            fontFamily: T.font.sans,
            fontSize: 12.5,
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.mutedMid; }}
        >
          {t("nav.apiKeys")}
        </a>
        <a
          href="/security"
          data-testid="nav-security"
          style={{
            display: "block",
            padding: "8px 12px",
            borderRadius: 10,
            color: T.mutedMid,
            fontFamily: T.font.sans,
            fontSize: 12.5,
            textDecoration: "none",
            transition: "all 0.15s",
          }}
          onMouseEnter={(e) => { e.currentTarget.style.background = "rgba(255,255,255,0.04)"; e.currentTarget.style.color = "#fff"; }}
          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; e.currentTarget.style.color = T.mutedMid; }}
        >
          {t("nav.security")}
        </a>
      </div>

      {/* Trainer */}
      <div
        style={{
          padding: "16px 20px 0",
          borderTop: `1px solid ${T.border}`,
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <div
          style={{
            width: 34,
            height: 34,
            borderRadius: "50%",
            background: T.gradients.sage,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 13,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initials(trainer.full_name, trainer.email)}
        </div>
        <div style={{ flex: 1, overflow: "hidden" }} data-testid="trainer-info">
          <div style={{ fontSize: 12.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {trainer.full_name || trainer.email}
          </div>
          <div style={{ fontSize: 10.5, color: T.muted }}>{t("sidebar.role")}</div>
        </div>
        <form action="/auth/signout" method="post" style={{ margin: 0 }}>
          <button
            type="submit"
            title={t("sidebar.signout")}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: T.muted,
              padding: 2,
              display: "flex",
            }}
          >
            <SettingsIcon />
          </button>
        </form>
      </div>
    </div>
  );
}
