"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import NewClientToast from "./NewClientToast";
import { T } from "@/lib/design-tokens";
import { LlmModelProvider } from "@/lib/llm-context";
import type { LlmCatalog } from "@/lib/llm-model";
import type { Trainer } from "@/lib/types";

type Props = {
  trainer: Trainer;
  llmCatalog: LlmCatalog | null;
  llmModel: string;
  children: React.ReactNode;
};

// Which nav entry (and therefore which header title) a URL belongs to. Longest
// prefix wins, so /clients/<id> still reads as Clients.
const NAV_BY_PREFIX: [string, string][] = [
  ["/clients", "clients"],
  ["/programme", "programme"],
  ["/knowledge", "knowledge"],
  ["/connections", "connections"],
  ["/api-keys", "apiKeys"],
  ["/security", "security"],
];

function navForPath(pathname: string): string {
  for (const [prefix, id] of NAV_BY_PREFIX) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return id;
  }
  return "dashboard";
}

export default function DashboardShell({ trainer, llmCatalog, llmModel, children }: Props) {
  const pathname = usePathname();
  // The sidebar sets this on click so the highlight moves before the route
  // does; the URL is the source of truth once navigation lands, which is what
  // keeps a deep link or a reload on the right entry.
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => { setPending(null); }, [pathname]);
  const activeNav = pending ?? navForPath(pathname);

  return (
    <LlmModelProvider catalog={llmCatalog} initialModel={llmModel}>
      <div style={{ display: "flex", height: "100vh", background: T.bg, overflow: "hidden" }}>
        <Sidebar activeNav={activeNav} setActiveNav={setPending} trainer={trainer} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", minWidth: 0 }}>
          <TopBar activeNav={activeNav} />
          {children}
        </div>
        <NewClientToast />
      </div>
    </LlmModelProvider>
  );
}
