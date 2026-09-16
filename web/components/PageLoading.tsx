"use client";

import { T } from "@/lib/design-tokens";
import { useI18n } from "@/lib/i18n-context";
import BrandLoader from "@/components/BrandLoader";

// Route-level loading fallback. Rendered by Next.js loading.tsx Suspense
// boundaries while a server-rendered page fetches its data, so navigations
// (switching tabs, opening a client) give immediate feedback instead of a
// frozen screen.
export default function PageLoading({ label }: { label?: string }) {
  const { t } = useI18n();
  return (
    <div style={{ padding: "22px 28px", flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="glass" style={{ borderRadius: T.radius.card, padding: "34px 44px" }}>
        <BrandLoader label={label ?? t("common.loading")} />
      </div>
    </div>
  );
}
