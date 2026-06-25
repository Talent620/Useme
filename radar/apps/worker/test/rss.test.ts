import { test } from "node:test";
import assert from "node:assert/strict";
import { parseFeed } from "../src/rss.ts";

const SAMPLE = `<?xml version="1.0"?>
<rss version="2.0"><channel>
  <item>
    <title>Szukam freelancera WordPress</title>
    <link>https://useme.com/pl/jobs/wp,1/</link>
    <description><![CDATA[Potrzebuję landing page. Budżet: 1500 zł.]]></description>
    <pubDate>Wed, 24 Jun 2026 10:00:00 +0000</pubDate>
  </item>
  <item>
    <title>Audyt SEO sklepu</title>
    <link>https://useme.com/pl/jobs/seo,2/</link>
    <description>Zlecę audyt SEO, budżet 3000 PLN</description>
    <pubDate>Wed, 24 Jun 2026 09:00:00 +0000</pubDate>
  </item>
</channel></rss>`;

test("parseFeed extracts items from RSS", () => {
  const items = parseFeed(SAMPLE);
  assert.equal(items.length, 2);
  assert.equal(items[0].title, "Szukam freelancera WordPress");
  assert.equal(items[0].url, "https://useme.com/pl/jobs/wp,1/");
  assert.ok(items[0].body.includes("landing page"));
  assert.ok(items[0].publishedAt?.startsWith("2026-06-24"));
});

test("parseFeed handles Atom entries", () => {
  const atom = `<feed><entry>
    <title>Need a React developer</title>
    <link href="https://x/job/3"/>
    <summary>Looking for React dev, urgent</summary>
    <updated>2026-06-20T08:00:00Z</updated>
  </entry></feed>`;
  const items = parseFeed(atom);
  assert.equal(items.length, 1);
  assert.equal(items[0].url, "https://x/job/3");
  assert.ok(items[0].body.includes("React"));
});
