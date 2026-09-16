import { cookies } from "next/headers";
import { DEFAULT_LOCALE, isLocale, LOCALE_COOKIE, t as translate, type Locale } from "./i18n";

/** Read the app-UI locale from the cookie inside a server component. */
export async function getLocale(): Promise<Locale> {
  const store = await cookies();
  const v = store.get(LOCALE_COOKIE)?.value;
  return isLocale(v) ? v : DEFAULT_LOCALE;
}

/** Convenience: bound translate() for the current request's locale. */
export async function getT(): Promise<(key: string) => string> {
  const locale = await getLocale();
  return (key: string) => translate(locale, key);
}
