"use client";

import { useState } from "react";
import { T } from "@/lib/design-tokens";

function ytId(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtu.be")) return u.pathname.slice(1).split("/")[0] || null;
    const v = u.searchParams.get("v");
    if (v) return v;
    const m = u.pathname.match(/\/(?:embed|shorts)\/([\w-]+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

// Pull the first YouTube URL out of free text / a sources list.
export function extractYouTubeUrl(...texts: (string | null | undefined)[]): string | null {
  for (const t of texts) {
    const m = String(t || "").match(/https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?[^\s)"']+|youtu\.be\/[\w-]+|youtube\.com\/(?:embed|shorts)\/[\w-]+)/);
    if (m) return m[0];
  }
  return null;
}

export default function YouTubeEmbed({ url }: { url: string }) {
  const [play, setPlay] = useState(false);
  const id = ytId(url);
  if (!id) {
    return <a href={url} target="_blank" rel="noopener noreferrer" style={{ color: T.accent, fontSize: 12 }}>{url}</a>;
  }
  if (play) {
    return (
      <div style={{ position: "relative", width: "100%", paddingBottom: "56.25%", borderRadius: 10, overflow: "hidden" }}>
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1`}
          title="YouTube tutorial"
          allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
          allowFullScreen
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%", border: 0 }}
        />
      </div>
    );
  }
  return (
    <button
      onClick={() => setPlay(true)}
      data-testid="youtube-thumb"
      style={{
        position: "relative", width: "100%", paddingBottom: "56.25%", border: `1px solid ${T.border}`,
        borderRadius: 10, overflow: "hidden", cursor: "pointer", padding: 0, background: "#000",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`https://img.youtube.com/vi/${id}/hqdefault.jpg`} alt="Tutorial thumbnail"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", opacity: 0.85 }} />
      <span style={{
        position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
        width: 46, height: 46, borderRadius: "50%", background: "rgba(196,76,60,0.92)",
        display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 18,
        boxShadow: "0 4px 14px rgba(0,0,0,0.5)",
      }}>▶</span>
    </button>
  );
}
