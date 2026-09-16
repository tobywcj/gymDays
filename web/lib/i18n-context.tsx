"use client";

import { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { htmlLang, LOCALE_COOKIE, t as translate, type Locale } from "./i18n";

type Ctx = {
  locale: Locale;
  setLocale: (l: Locale) => void;
  t: (key: string) => string;
};

const I18nContext = createContext<Ctx | null>(null);

export function I18nProvider({
  initial,
  children,
}: {
  initial: Locale;
  children: React.ReactNode;
}) {
  const [locale, setLocaleState] = useState<Locale>(initial);
  const router = useRouter();

  const setLocale = useCallback((l: Locale) => {
    setLocaleState(l);
    document.cookie = `${LOCALE_COOKIE}=${l}; path=/; max-age=31536000; samesite=lax`;
    document.documentElement.lang = htmlLang(l);
    // Client components update from the state above; server-rendered cards
    // (ScreeningSummary, FirstLessonChecklist, …) read the locale from the
    // cookie via getT() at request time, so re-render the server tree too.
    router.refresh();
  }, [router]);

  const t = useCallback((key: string) => translate(locale, key), [locale]);

  return (
    <I18nContext.Provider value={{ locale, setLocale, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): Ctx {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within an I18nProvider");
  return ctx;
}
