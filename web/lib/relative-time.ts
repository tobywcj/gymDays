import type { Locale } from "./i18n";

/** Locale-aware "x ago" formatter shared across dashboard surfaces. */
export function relativeTime(locale: Locale, iso: string | number | Date): string {
  const ms = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  const seconds = Math.floor((Date.now() - ms) / 1000);
  const zh = locale === "zh";
  if (seconds < 60) return zh ? `${seconds} 秒前` : `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return zh ? `${minutes} 分鐘前` : `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return zh ? `${hours} 小時前` : `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  return zh ? `${days} 天前` : `${days}d ago`;
}

/** "just now / Xh ago / Xd ago" — coarser variant used by the invites strip. */
export function timeAgoCoarse(locale: Locale, iso: string): string {
  const h = Math.floor((Date.now() - new Date(iso).getTime()) / 3_600_000);
  const zh = locale === "zh";
  if (h < 1) return zh ? "剛剛" : "just now";
  if (h < 24) return zh ? `${h} 小時前` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return zh ? `${d} 天前` : `${d}d ago`;
}

/** Countdown to an expiry timestamp. */
export function daysLeft(locale: Locale, expiresAt: string): string {
  const ms = new Date(expiresAt).getTime() - Date.now();
  const zh = locale === "zh";
  if (ms <= 0) return zh ? "已過期" : "expired";
  const d = Math.floor(ms / 86_400_000);
  if (d === 0) {
    const h = Math.floor(ms / 3_600_000);
    return zh ? `剩 ${h} 小時` : `${h}h left`;
  }
  return zh ? `剩 ${d} 天` : `${d}d left`;
}
