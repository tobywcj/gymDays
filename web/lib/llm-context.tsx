"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { LLM_MODEL_COOKIE, type LlmCatalog } from "./llm-model";

type Ctx = {
  // Null when the AI service is unreachable (the /llms fetch failed).
  catalog: LlmCatalog | null;
  model: string;
  setModel: (m: string) => void;
};

const LlmContext = createContext<Ctx | null>(null);

export function LlmModelProvider({
  catalog,
  initialModel,
  children,
}: {
  catalog: LlmCatalog | null;
  initialModel: string;
  children: React.ReactNode;
}) {
  const [model, setModelState] = useState(initialModel);
  const router = useRouter();

  const setModel = useCallback((m: string) => {
    setModelState(m);
    document.cookie = `${LLM_MODEL_COOKIE}=${encodeURIComponent(m)}; path=/; max-age=31536000; samesite=lax`;
    // Server routes read the selection from the cookie at request time, so
    // re-render the server tree to pick up the new default everywhere.
    router.refresh();
  }, [router]);

  return (
    <LlmContext.Provider value={{ catalog, model, setModel }}>
      {children}
    </LlmContext.Provider>
  );
}

export function useLlmModel(): Ctx {
  const ctx = useContext(LlmContext);
  if (!ctx) throw new Error("useLlmModel must be used within an LlmModelProvider");
  return ctx;
}
