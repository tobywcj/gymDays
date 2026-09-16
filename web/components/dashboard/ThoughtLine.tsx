"use client";

import { T } from "@/lib/design-tokens";

// Backend joins the *what* (action label + hint) and the *why* (the model's
// reasoning) with this separator — see ai/crew/thoughts.py `_join`.
const SEP = "  ·  ";
// Backend prefixes each line with the active agent's label, joined with this
// separator — see ai/crew/thoughts.py `_AGENT_SEP`.
const AGENT_SEP = "  ⟫  ";

/** Flatten a streamed thought line into a short single-line string suitable
 *  for inline spinner labels: "{agent} · {what}", dropping the longer "why".
 *  Pass-through for undefined so callers can `plainThought(x) ?? fallback`. */
export function plainThought(line?: string): string | undefined {
  if (!line) return line;
  let agent = "";
  let rest = line;
  const a = line.indexOf(AGENT_SEP);
  if (a !== -1) {
    agent = line.slice(0, a);
    rest = line.slice(a + AGENT_SEP.length);
  }
  const i = rest.indexOf(SEP);
  const what = i === -1 ? rest : rest.slice(0, i);
  return agent ? `${agent} · ${what}` : what;
}

/** One streamed agent thought: an optional agent pill (which agent is
 *  thinking), the action, plus the model's reasoning ("why") rendered dimmer
 *  + italic so the parts read as distinct. */
export default function ThoughtLine({ line }: { line: string }) {
  // Peel off the agent label, if present.
  let agent = "";
  let rest = line;
  const a = line.indexOf(AGENT_SEP);
  if (a !== -1) {
    agent = line.slice(0, a);
    rest = line.slice(a + AGENT_SEP.length);
  }

  const i = rest.indexOf(SEP);
  const what = i === -1 ? rest : rest.slice(0, i);
  const why = i === -1 ? "" : rest.slice(i + SEP.length);

  return (
    <>
      {agent && (
        <span
          style={{
            display: "inline-block",
            fontSize: "0.85em",
            fontWeight: 600,
            padding: "1px 7px",
            marginRight: 6,
            borderRadius: 99,
            background: "rgba(196,148,82,0.18)",
            border: "1px solid rgba(196,148,82,0.35)",
            color: T.text,
            whiteSpace: "nowrap",
            verticalAlign: "baseline",
          }}
        >
          {agent}
        </span>
      )}
      {what}
      {why && (
        <span style={{ opacity: 0.6, fontStyle: "italic", color: T.muted }}>
          {" — "}
          {why}
        </span>
      )}
    </>
  );
}
