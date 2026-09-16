"use client";

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { T } from "@/lib/design-tokens";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

const CHIP = 26;

type Props = {
  names: string[];
  /** Accent colour used for the chip ring + initials. */
  accent: string;
  /** Max chips before collapsing into a "+N" badge. */
  max?: number;
  /** Rendered when there are no names (e.g. an "all clear" state). */
  empty?: React.ReactNode;
  /** Heading shown at the top of the hover popover. */
  title?: string;
};

function chipStyle(accent: string): React.CSSProperties {
  return {
    width: CHIP,
    height: CHIP,
    borderRadius: "50%",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    fontSize: 9,
    fontWeight: 700,
    fontFamily: T.font.sans,
    letterSpacing: "0.01em",
    border: "1.5px solid rgba(20,24,18,0.85)",
    flexShrink: 0,
    background: `${accent}26`,
    boxShadow: `inset 0 0 0 1px ${accent}55`,
    color: accent,
  };
}

export default function AvatarStack({ names, accent, max = 4, empty, title }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [anchor, setAnchor] = useState<{ right: number; top: number } | null>(null);

  if (names.length === 0) return <>{empty ?? null}</>;

  const shown = names.slice(0, max);
  const overflow = names.length - shown.length;

  const open = () => {
    const r = ref.current?.getBoundingClientRect();
    if (r) setAnchor({ right: r.right, top: r.top });
  };
  const close = () => setAnchor(null);

  return (
    <div
      ref={ref}
      onMouseEnter={open}
      onMouseLeave={close}
      style={{ display: "flex", alignItems: "center", cursor: "default" }}
    >
      {shown.map((n, i) => (
        <div key={i} style={{ ...chipStyle(accent), marginLeft: i === 0 ? 0 : -8, zIndex: i + 1 }}>
          {initials(n)}
        </div>
      ))}
      {overflow > 0 && (
        <div
          style={{
            ...chipStyle(accent),
            marginLeft: -8,
            zIndex: shown.length + 1,
            background: "rgba(255,252,245,0.10)",
            boxShadow: "inset 0 0 0 1px rgba(255,252,245,0.18)",
            color: T.mutedMid,
          }}
        >
          +{overflow}
        </div>
      )}

      {anchor &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            style={{
              position: "fixed",
              left: anchor.right,
              top: anchor.top - 10,
              transform: "translate(-100%, -100%)",
              zIndex: 1000,
              minWidth: 184,
              maxWidth: 260,
              maxHeight: 280,
              overflowY: "auto",
              padding: "12px 14px",
              borderRadius: 14,
              background: "rgba(28, 32, 26, 0.92)",
              border: "1px solid rgba(255,252,245,0.14)",
              boxShadow: "0 18px 40px -10px rgba(0,0,0,0.6), 0 0 0 0.5px rgba(255,252,245,0.06) inset",
              backdropFilter: "blur(18px)",
              WebkitBackdropFilter: "blur(18px)",
              pointerEvents: "none",
            }}
          >
            {title && (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 8,
                  marginBottom: 10,
                }}
              >
                <span
                  style={{
                    fontFamily: T.font.sans,
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.12em",
                    textTransform: "uppercase",
                    color: "rgba(244,237,226,0.55)",
                  }}
                >
                  {title}
                </span>
                <span style={{ fontFamily: T.font.mono, fontSize: 11, color: accent }}>{names.length}</span>
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {names.map((n, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 9 }}>
                  <div style={{ ...chipStyle(accent), width: 22, height: 22, fontSize: 8 }}>{initials(n)}</div>
                  <span
                    style={{
                      fontFamily: T.font.sans,
                      fontSize: 12,
                      color: T.text,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {n}
                  </span>
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
