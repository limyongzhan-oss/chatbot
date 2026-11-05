export const TZ = "Asia/Singapore";

export function todaySG(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
}

/** Accept ?date=YYYY-MM-DD, otherwise today in Singapore. */
export function pickDate(raw: string | string[] | undefined): string {
  const v = Array.isArray(raw) ? raw[0] : raw;
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : todaySG();
}

export function prettyDate(d: string): string {
  return new Date(d + "T00:00:00").toLocaleDateString("en-SG", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}
