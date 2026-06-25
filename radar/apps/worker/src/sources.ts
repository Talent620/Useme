// Registry of public sources. Add a feed here and it gets crawled.
// IMPORTANT: respect each site's ToS/robots.txt. Prefer official feeds/APIs.

import type { SourceKind } from "@radar/core";

export interface SourceDef {
  name: string;
  kind: SourceKind;
  /** RSS/Atom feed URL, or an API endpoint handled by a custom adapter. */
  feed: string;
  enabled: boolean;
}

// Starter set — public feeds. Replace/extend with verified, ToS-compliant URLs.
export const SOURCES: SourceDef[] = [
  { name: "useme", kind: "job_board", feed: "https://useme.com/pl/jobs/feed/", enabled: true },
  { name: "oferia", kind: "job_board", feed: "https://www.oferia.pl/rss", enabled: false },
  { name: "bzp", kind: "tender", feed: "https://ezamowienia.gov.pl/rss", enabled: false },
  { name: "ted-eu", kind: "tender", feed: "https://ted.europa.eu/rss", enabled: false },
];

// Default category taxonomy used for tagging. Extend per vertical.
export const TAXONOMY: Record<string, string[]> = {
  wordpress: ["wordpress", "woocommerce", "elementor"],
  web: ["strona", "landing", "website", "frontend", "react", "next"],
  seo: ["seo", "pozycjonowanie", "audyt seo"],
  ecommerce: ["sklep", "shopify", "magento", "e-commerce", "allegro"],
  copywriting: ["copywriting", "treści", "artykuł", "tekst"],
  graphic: ["logo", "grafika", "branding", "ui", "ux"],
  ads: ["google ads", "meta ads", "facebook ads", "kampania"],
  automation: ["automatyzacja", "n8n", "zapier", "integracja", "api"],
};
