// Splits free-text verification evidence into text and link segments.
//
// Only absolute http(s) URLs become links. Anything else that looks like a
// URL (javascript:, data:, relative paths) stays plain text, so evidence
// written by a requester can never run script in the reviewer's session.

export type EvidenceSegment =
  | { type: "text"; value: string }
  | { type: "link"; value: string; href: string };

const URL_PATTERN = /https?:\/\/[^\s<>"'`]+/gi;
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/;

/** Returns the normalised URL when `raw` is a safe http(s) link, else null. */
export function toSafeHref(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    if (url.username || url.password) return null;
    return url.href;
  } catch {
    return null;
  }
}

export function parseEvidence(evidence: string): EvidenceSegment[] {
  const segments: EvidenceSegment[] = [];
  let cursor = 0;

  const pushText = (value: string) => {
    if (!value) return;
    const last = segments[segments.length - 1];
    if (last?.type === "text") last.value += value;
    else segments.push({ type: "text", value });
  };

  for (const match of evidence.matchAll(URL_PATTERN)) {
    const start = match.index ?? 0;
    const candidate = match[0].replace(TRAILING_PUNCTUATION, "");
    const href = toSafeHref(candidate);
    pushText(evidence.slice(cursor, start));
    if (href) {
      segments.push({ type: "link", value: candidate, href });
    } else {
      pushText(candidate);
    }
    cursor = start + candidate.length;
  }
  pushText(evidence.slice(cursor));
  return segments;
}
