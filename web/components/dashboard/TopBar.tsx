"use client";

import { useState } from "react";
import Link from "next/link";
import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import AppLanguageToggle from "./AppLanguageToggle";
import ModelSelect from "./ModelSelect";
import { SearchIcon, BellIcon, PlusIcon } from "./icons";

export default function TopBar({ activeNav }: { activeNav: string }) {
  const [q, setQ] = useState("");
  const { t } = useI18n();
  const title = t(`nav.${activeNav}`);
  return (
    <div
      style={{
        height: 64,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "0 28px",
        borderBottom: `1px solid ${T.border}`,
        background: "rgba(20, 26, 18, 0.45)",
        flexShrink: 0,
        position: "relative",
        zIndex: 2,
        boxShadow: "0 1px 0 rgba(255,252,245,0.06) inset",
      }}
    >
      <span style={{ fontFamily: T.font.sans, fontWeight: 700, fontSize: 20, letterSpacing: "-0.02em", flex: 1 }}>
        {title}
      </span>

      <div style={{ position: "relative", display: "flex", alignItems: "center" }}>
        <span style={{ position: "absolute", left: 11, color: T.muted, display: "flex" }}>
          <SearchIcon />
        </span>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t("topbar.search")}
          style={{
            background: "rgba(0, 0, 0, 0.25)",
            border: `1px solid ${T.border}`,
            borderRadius: 99,
            padding: "8px 14px 8px 34px",
            color: T.text,
            fontFamily: T.font.sans,
            fontSize: 13,
            outline: "none",
            width: 200,
            boxShadow: "0 1px 0 rgba(255,252,245,0.06) inset",
          }}
        />
      </div>

      <ModelSelect />

      <AppLanguageToggle />

      <button
        style={{
          background: "none",
          border: "none",
          cursor: "pointer",
          color: T.mutedMid,
          position: "relative",
          display: "flex",
          padding: 6,
        }}
      >
        <BellIcon />
        <span
          style={{
            position: "absolute",
            top: 4,
            right: 4,
            width: 7,
            height: 7,
            borderRadius: "50%",
            background: "#e4c08c",
            boxShadow: "0 0 6px #c4946a",
          }}
        />
      </button>

      <Link
        href="/clients/new"
        data-testid="add-client"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 7,
          background: "linear-gradient(135deg, rgba(196,148,82,0.95) 0%, rgba(140,92,48,0.95) 100%)",
          border: "1px solid rgba(255,252,245,0.25)",
          borderRadius: 99,
          padding: "9px 18px",
          color: "#fffdf6",
          fontFamily: T.font.sans,
          fontSize: 13,
          fontWeight: 600,
          cursor: "pointer",
          textDecoration: "none",
          boxShadow: "0 1px 0 rgba(255,252,245,0.45) inset, 0 6px 20px rgba(140,92,48,0.45)",
          transition: "opacity 0.15s",
        }}
      >
        <PlusIcon /> {t("topbar.addClient")}
      </Link>
    </div>
  );
}
