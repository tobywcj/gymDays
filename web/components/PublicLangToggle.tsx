"use client";

// Fixed top-right language switch for pages outside the dashboard chrome
// (login, onboarding, legal). Reuses the same AppLanguageToggle UI.
import AppLanguageToggle from "@/components/dashboard/AppLanguageToggle";

export default function PublicLangToggle() {
  return (
    <div style={{ position: "fixed", top: 16, right: 18, zIndex: 50 }}>
      <AppLanguageToggle />
    </div>
  );
}
