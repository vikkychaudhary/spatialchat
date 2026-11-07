const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
const shortFmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" });

export const formatTime = (iso: string) => timeFmt.format(new Date(iso));
const sameDay = (a: Date, b: Date) => a.toDateString() === b.toDateString();

export function formatListTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return timeFmt.format(d);
  const diffDays = (now.getTime() - d.getTime()) / 86_400_000;
  return diffDays < 7 ? new Intl.DateTimeFormat(undefined, { weekday: "short" }).format(d) : shortFmt.format(d);
}
export function dayLabel(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  if (sameDay(d, now)) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  return sameDay(d, y) ? "Yesterday" : dateFmt.format(d);
}
export const dayKey = (iso: string) => new Date(iso).toDateString();

export function lastSeenText(p: { online: boolean; lastSeenAt: string | null } | null): string {
  if (!p) return "";
  if (p.online) return "Online";
  return p.lastSeenAt ? `Last seen ${formatListTime(p.lastSeenAt)}` : "Offline";
}
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "?";
