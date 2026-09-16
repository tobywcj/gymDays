"use client";

import { useState } from "react";
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

export default function DashboardShell({ trainer, llmCatalog, llmModel, children }: Props) {
  const [activeNav, setActiveNav] = useState("dashboard");
  return (
    <LlmModelProvider catalog={llmCatalog} initialModel={llmModel}>
      <div style={{ display: "flex", height: "100vh", background: T.bg, overflow: "hidden" }}>
        <Sidebar activeNav={activeNav} setActiveNav={setActiveNav} trainer={trainer} />
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflowY: "auto", minWidth: 0 }}>
          <TopBar activeNav={activeNav} />
          {children}
        </div>
        <NewClientToast />
      </div>
    </LlmModelProvider>
  );
}
