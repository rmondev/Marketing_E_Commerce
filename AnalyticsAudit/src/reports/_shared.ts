// Shared helpers used by both the Markdown rolling report (generator.ts)
// and the HTML trend report (trend-generator.ts). Anything format-specific
// (Markdown table cells, HTML escaping, donut JSON shape) stays in the
// respective generator.

export const DEMOGRAPHIC_DIMENSIONS_ORDER = [
  "age",
  "gender",
  "country",
  "city",
] as const;
type DimensionName = (typeof DEMOGRAPHIC_DIMENSIONS_ORDER)[number];

export const DEMOGRAPHIC_TOP_N = 5;
export const CAPTION_PREVIEW_CHARS = 30;
export const HASHTAGS_PER_ROW = 10;

const COUNTRY_DISPLAY = new Intl.DisplayNames(["en"], { type: "region" });

export function expandBucketLabel(dimension: string, raw: string): string {
  if (dimension === "gender") return expandGender(raw);
  if (dimension === "country") return expandCountry(raw);
  return raw;
}

function expandGender(raw: string): string {
  switch (raw.toUpperCase()) {
    case "F":
      return "Female";
    case "M":
      return "Male";
    case "U":
      return "Undisclosed";
    default:
      return raw;
  }
}

function expandCountry(code: string): string {
  try {
    return COUNTRY_DISPLAY.of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

export function dimensionLabel(dim: DimensionName | string): string {
  switch (dim) {
    case "age":
      return "Age";
    case "gender":
      return "Gender";
    case "country":
      return "Top Countries";
    case "city":
      return "Top Cities";
    default:
      return dim;
  }
}

export function dimensionDescription(dim: DimensionName | string): string {
  switch (dim) {
    case "age":
      return "Distribution across age brackets. Reveals which generation(s) the content resonates with.";
    case "gender":
      return "Self-reported gender distribution. \"Undisclosed\" means the user didn't specify a gender on their Instagram profile.";
    case "country":
      return "Which countries the audience lives in. Useful for spotting unexpected international reach.";
    case "city":
      return "Metro areas the audience clusters around. Most actionable for local businesses.";
    default:
      return "";
  }
}

// Truncate to a preview length. Collapses internal whitespace so embedded
// newlines don't break table cells.
export function truncateCaption(caption: string | null, len: number): string {
  if (!caption) return "(no caption)";
  const flat = caption.replace(/\s+/g, " ").trim();
  if (flat.length <= len) return flat;
  return flat.slice(0, len).trimEnd() + "…";
}

// Extracts unique hashtags (with leading #) from a caption. Case-insensitive
// dedupe; first-seen casing wins.
export function extractHashtags(caption: string | null): string[] {
  if (!caption) return [];
  const matches = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of matches) {
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

export function hashtagSearchUrl(tag: string): string {
  const stripped = tag.startsWith("#") ? tag.slice(1) : tag;
  return `https://www.instagram.com/explore/tags/${encodeURIComponent(stripped)}/`;
}

// Engagement Rate by Reach. The "fair" denominator: most followers don't see
// most posts, so dividing by followers would penalize posts for the
// algorithm's distribution choices. Reach measures the post against the
// people who actually had the chance to engage.
export function computeEngagementRate(p: {
  like_count: number;
  comments_count: number;
  saved: number | null;
  shares: number | null;
  reach: number | null;
}): number | null {
  if (p.reach === null || p.reach === 0) return null;
  const engagement =
    p.like_count + p.comments_count + (p.saved ?? 0) + (p.shares ?? 0);
  return (engagement / p.reach) * 100;
}

export function formatEr(rate: number | null): string {
  return rate === null ? "—" : `${rate.toFixed(1)}%`;
}

// Sort buckets descending by value, take top N, lump the tail into "Other".
// Returns { head, otherValue, otherCount }. The tail is reported as a single
// "Other" bucket so donut/list rendering can decide how to label it.
export function topNplusOther(
  buckets: { bucket: string; value: number }[],
  topN = DEMOGRAPHIC_TOP_N,
): {
  head: { bucket: string; value: number }[];
  otherValue: number;
  otherCount: number;
} {
  const sorted = [...buckets].sort((a, b) => b.value - a.value);
  const head = sorted.slice(0, topN);
  const tail = sorted.slice(topN);
  const otherValue = tail.reduce((s, b) => s + b.value, 0);
  return { head, otherValue, otherCount: tail.length };
}
