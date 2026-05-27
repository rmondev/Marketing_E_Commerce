// Presentation-time formatting. All timestamps in the database stay in UTC
// (ISO 8601 strings) — these helpers exist only to render those values in
// Eastern Time for human consumption (reports, console output).
// `America/New_York` auto-switches between EST and EDT around DST.

const TZ = "America/New_York";

// Returns "YYYY-MM-DD" for the ET calendar date corresponding to the given
// UTC ISO timestamp. en-CA locale outputs YYYY-MM-DD natively, so we lean
// on it rather than re-assembling from formatToParts.
export function toEtDate(iso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(iso));
}

// Returns "YYYY-MM-DD HH:MM:SS TZN" (e.g. "2026-05-26 17:46:38 EDT").
export function toEtTimestamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")} ${get("timeZoneName")}`;
}
