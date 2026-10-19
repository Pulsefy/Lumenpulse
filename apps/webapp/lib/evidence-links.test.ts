import { describe, expect, it } from "vitest";
import { parseEvidence, toSafeHref } from "./evidence-links";

describe("toSafeHref", () => {
  it.each(["https://github.com/org/repo", "http://example.com/a?b=1#c"])("accepts %s", (url) => {
    expect(toSafeHref(url)).toBe(new URL(url).href);
  });

  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "/relative/path",
    "ftp://example.com/file",
    "https://user:pass@example.com",
    "not a url",
  ])("rejects %s", (url) => {
    expect(toSafeHref(url)).toBeNull();
  });
});

describe("parseEvidence", () => {
  it("splits text and links, dropping trailing punctuation from the link", () => {
    expect(parseEvidence("See https://github.com/acme/app. Also docs.")).toEqual([
      { type: "text", value: "See " },
      { type: "link", value: "https://github.com/acme/app", href: "https://github.com/acme/app" },
      { type: "text", value: ". Also docs." },
    ]);
  });

  it("finds several links on separate lines", () => {
    const links = parseEvidence("repo: https://a.dev/x\nsite: http://b.dev").filter(
      (s) => s.type === "link",
    );
    expect(links.map((l) => l.value)).toEqual(["https://a.dev/x", "http://b.dev"]);
  });

  it("never turns a javascript: URL into a link", () => {
    const segments = parseEvidence("click javascript:alert(document.cookie)");
    expect(segments).toEqual([{ type: "text", value: "click javascript:alert(document.cookie)" }]);
  });

  it("returns a single text segment when there are no links", () => {
    expect(parseEvidence("Signed letter attached offline.")).toEqual([
      { type: "text", value: "Signed letter attached offline." },
    ]);
  });
});
