export const T = {
  bg: "transparent",
  bgCard: "rgba(255, 252, 245, 0.05)",
  bgSidebar: "rgba(20, 26, 18, 0.55)",
  muted: "rgba(244, 237, 226, 0.42)",
  mutedMid: "rgba(244, 237, 226, 0.65)",
  text: "#f4ede2",
  border: "rgba(244, 237, 226, 0.10)",
  gradients: {
    moss: "linear-gradient(135deg, rgba(98,132,88,0.55) 0%,  rgba(58,82,52,0.55) 100%)",
    ochre: "linear-gradient(135deg, rgba(196,148,82,0.55) 0%, rgba(140,92,48,0.55) 100%)",
    terracotta: "linear-gradient(135deg, rgba(196,108,76,0.55) 0%, rgba(132,60,44,0.55) 100%)",
    sage: "linear-gradient(135deg, rgba(140,164,140,0.55) 0%, rgba(80,108,88,0.55) 100%)",
  },
  accent: "#c4946a",
  accentBlue: "#7a948c",
  accentMoss: "#86a378",
  radius: { card: 20, pill: 99, sm: 8, md: 12 },
  font: { mono: "'Share Tech Mono', monospace", sans: "'Inter', sans-serif" },
} as const;

export type Tint = "moss" | "ochre" | "terracotta" | "sage";
