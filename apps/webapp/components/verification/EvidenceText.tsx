import { ExternalLink } from "lucide-react";
import { parseEvidence } from "@/lib/evidence-links";

/**
 * Renders requester-supplied evidence. Links open in a new browsing context
 * with no opener, no referrer, and no ranking signal; non-http(s) URLs stay
 * as plain text.
 */
export function EvidenceText({ evidence }: { evidence: string }) {
  return (
    <p className="whitespace-pre-wrap break-words text-sm text-foreground/70">
      {parseEvidence(evidence).map((segment, i) =>
        segment.type === "link" ? (
          <a
            key={i}
            href={segment.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            referrerPolicy="no-referrer"
            className="inline-flex items-center gap-1 text-primary underline underline-offset-2 hover:text-primary/80"
          >
            {segment.value}
            <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : (
          <span key={i}>{segment.value}</span>
        ),
      )}
    </p>
  );
}
