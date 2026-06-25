// Minimal dependency-free RSS/Atom reader. Many public job boards and
// procurement portals expose feeds — the cheapest, most polite ingestion path.

import type { RawListing } from "@radar/core";

function pick(block: string, tag: string): string {
  const m = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i"));
  if (!m) return "";
  return m[1]
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pickLink(block: string): string {
  const rss = block.match(/<link[^>]*>([\s\S]*?)<\/link>/i);
  if (rss && rss[1].trim()) return rss[1].trim();
  const atom = block.match(/<link[^>]*href="([^"]+)"/i);
  return atom ? atom[1] : "";
}

export function parseFeed(xml: string): RawListing[] {
  const blocks = xml.match(/<(item|entry)[\s\S]*?<\/(item|entry)>/gi) ?? [];
  return blocks.map((b) => {
    const title = pick(b, "title");
    const body = pick(b, "description") || pick(b, "summary") || pick(b, "content");
    const date = pick(b, "pubDate") || pick(b, "updated") || pick(b, "published");
    const publishedAt = date ? new Date(date).toISOString() : undefined;
    return { url: pickLink(b), title, body, publishedAt, rawBudget: body };
  }).filter((r) => r.title && r.url);
}

export async function fetchFeed(url: string, userAgent: string): Promise<RawListing[]> {
  const res = await fetch(url, { headers: { "User-Agent": userAgent, Accept: "application/rss+xml, application/atom+xml, application/xml" } });
  if (!res.ok) throw new Error(`feed ${url} -> HTTP ${res.status}`);
  return parseFeed(await res.text());
}
