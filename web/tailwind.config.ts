import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        text: "#f4ede2",
        bg: "#1c2418",
        muted: "rgba(244,237,226,0.42)",
        mutedMid: "rgba(244,237,226,0.65)",
        accent: "#c4946a",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["'Share Tech Mono'", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
