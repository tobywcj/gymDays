import { cookies } from "next/headers";
import { LLM_MODEL_COOKIE } from "./llm-model";

/**
 * Read the globally-selected LLM model from the cookie inside a server context
 * (route handler or server component). Returns undefined when unset, so the AI
 * service falls back to its own default (LLM_MODEL). This is the single source
 * of truth for which model every AI feature uses — clients no longer pass one.
 */
export async function getLlmModel(): Promise<string | undefined> {
  const v = (await cookies()).get(LLM_MODEL_COOKIE)?.value?.trim();
  return v || undefined;
}
