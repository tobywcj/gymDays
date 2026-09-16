"use client";

type Props = {
  emoji?: string;
  label?: string;
};

export default function Spinner({ emoji = "⚙️", label }: Props) {
  return (
    <>
      <style>{`@keyframes spin-emoji { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        <span style={{ display: "inline-block", animation: "spin-emoji 1s linear infinite", lineHeight: 1 }}>
          {emoji}
        </span>
        {label && <span>{label}</span>}
      </span>
    </>
  );
}
