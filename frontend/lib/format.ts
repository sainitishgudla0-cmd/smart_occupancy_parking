const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Timestamps are plain text as recorded in the source, so they are never converted between time zones. */
function parts(iso: string) {
  const [date, time = ""] = iso.split("T");
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { year, month, day, weekday, time };
}

export function formatDate(iso: string): string {
  const p = parts(iso);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

export function formatDateShort(iso: string): string {
  const p = parts(iso);
  return `${DAYS[p.weekday]} ${p.day} ${MONTHS[p.month - 1]}`;
}

export function formatDateTime(iso: string): string {
  const p = parts(iso);
  return `${formatDate(iso)}, ${p.time}`;
}

export function timeOf(iso: string): string {
  return parts(iso).time;
}

export function pct(rate: number | null | undefined, digits = 0): string {
  return rate === null || rate === undefined ? "n/a" : `${(rate * 100).toFixed(digits)}%`;
}

export function num(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : value.toLocaleString("en-GB");
}
