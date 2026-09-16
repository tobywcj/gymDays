"use client";

import React from "react";
import { T } from "@/lib/design-tokens";

// Inline markdown → HTML: bold (**x**), links ([text](url)), and footnote markers
// ([^n] → a superscript citation number). Links open in a new tab so citation
// sources are clickable. URLs are escaped for the attribute.
function inline(s: string): string {
  return s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_m, label, url) => {
      const safeUrl = String(url).replace(/"/g, "%22");
      return `<a href="${safeUrl}" target="_blank" rel="noopener noreferrer" style="color:${T.accent};text-decoration:underline">${label}</a>`;
    })
    .replace(/\[\^(\d+)\]/g, (_m, n) =>
      `<sup style="color:${T.accent};font-weight:700;font-size:0.7em;padding-left:1px">${n}</sup>`)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

export default function MarkdownSummary({ text }: { text: string }) {
  // Normalise inline markdown: insert newlines before ## headings and bullet markers
  const normalised = text
    .replace(/(##\s+)/g, "\n$1")
    .replace(/(?:^|\s)(-\s)/gm, "\n- ");

  const lines = normalised.split("\n");
  const elements: React.ReactNode[] = [];
  let bulletBuffer: string[] = [];

  function flushBullets() {
    if (bulletBuffer.length === 0) return;
    elements.push(
      <ul key={elements.length} style={{ margin: "4px 0 10px 0", paddingLeft: 0, listStyle: "none" }}>
        {bulletBuffer.map((b, i) => (
          <li key={i} style={{ display: "flex", gap: 8, fontSize: 12, color: T.mutedMid, lineHeight: 1.6, marginBottom: 4 }}>
            <span style={{ color: "#e4c08c", flexShrink: 0 }}>·</span>
            <span dangerouslySetInnerHTML={{ __html: inline(b) }} />
          </li>
        ))}
      </ul>
    );
    bulletBuffer = [];
  }

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flushBullets(); continue; }

    if (line.startsWith("## ")) {
      flushBullets();
      elements.push(
        <div key={elements.length} style={{
          fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase",
          color: "#e4c08c",
          marginTop: elements.length > 0 ? 14 : 0, marginBottom: 5,
          borderBottom: "1px solid rgba(196,148,82,0.2)", paddingBottom: 4,
        }}>
          {line.slice(3)}
        </div>
      );
    } else if (/^[-•*] /.test(line)) {
      bulletBuffer.push(line.slice(2).trim());
    } else {
      flushBullets();
      elements.push(
        <p key={elements.length} style={{ margin: "0 0 6px", fontSize: 12, color: T.mutedMid, lineHeight: 1.6 }}
          dangerouslySetInnerHTML={{ __html: inline(line) }}
        />
      );
    }
  }
  flushBullets();
  return <div style={{ paddingTop: 2 }}>{elements}</div>;
}
