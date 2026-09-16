import "./globals.css";
import type { Metadata } from "next";
import { I18nProvider } from "@/lib/i18n-context";
import { getLocale } from "@/lib/i18n-server";
import { htmlLang } from "@/lib/i18n";
import SpaceBackground from "@/components/SpaceBackground";

export const metadata: Metadata = {
  title: "Gym Days — Dashboard",
  description: "AI-powered client management for personal trainers.",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={htmlLang(locale)} suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          href="https://fonts.googleapis.com/css2?family=Share+Tech+Mono&family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>
        <SpaceBackground />
        <div style={{ position: "relative", zIndex: 1, height: "100%", width: "100%" }}>
          <I18nProvider initial={locale}>{children}</I18nProvider>
        </div>
      </body>
    </html>
  );
}
