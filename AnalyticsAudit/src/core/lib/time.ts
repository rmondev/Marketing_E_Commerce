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
// Used in compact contexts (footer, audit console output).
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

// Returns "Monday June 5, 2026 1:26 PM EDT" — readable format used in report
// headers and per-snapshot "Captured" lines. No commas (after weekday), no
// "at" — assembled from Intl parts to match the requested format exactly.
export function toReadableEtTimestamp(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZoneName: "short",
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("month")} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")} ${get("timeZoneName")}`;
}

// Returns "Jun 5, 2026 1:30 PM" — compact form for table cells where the
// full readable timestamp would be too wide. No weekday, no timezone (the
// timezone is consistent across the report so callers don't need to repeat).
export function toShortReadableEt(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")} ${get("hour")}:${get("minute")} ${get("dayPeriod")}`;
}

// Returns "Monday June 5, 2026" — readable date-only form for per-snapshot
// section headings where time-of-day is shown separately on the next line.
export function toReadableEtDate(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("weekday")} ${get("month")} ${get("day")}, ${get("year")}`;
}

// Returns "June 5, 2026" — long month, no weekday, no time. Used where the
// weekday-prefixed form is too verbose (chart axis labels, etc.).
export function toLongDateEt(iso: string): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    month: "long",
    day: "numeric",
    year: "numeric",
  }).formatToParts(new Date(iso));
  const get = (type: string): string =>
    parts.find((p) => p.type === type)?.value ?? "";
  return `${get("month")} ${get("day")}, ${get("year")}`;
}

// Returns "2026-06-09_091038-EDT" — filesystem-safe, sortable, timezone
// explicit. Used for the trend-report HTML filenames so they can be sorted
// lexically and remain unambiguous when reviewed out of context.
export function toFilenameSafeTimestampEt(iso: string): string {
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
  return `${get("year")}-${get("month")}-${get("day")}_${get("hour")}${get("minute")}${get("second")}-${get("timeZoneName")}`;
}
