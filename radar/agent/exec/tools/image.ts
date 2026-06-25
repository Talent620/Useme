// Image generation tool. With a Higgsfield key it calls the real generator;
// otherwise it produces a deterministic, prompt-derived SVG (a real, embeddable
// asset — not a placeholder string). Same interface either way, so the landing
// builder doesn't care which backend produced the image.

export interface GeneratedImage {
  kind: "svg" | "url";
  /** Inline SVG markup (kind=svg) — embeddable directly in HTML. */
  svg?: string;
  /** data: URI (kind=svg) or remote URL (kind=url) — usable as <img src>. */
  src: string;
  prompt: string;
}

function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function deterministicSvg(prompt: string): string {
  const h = hash(prompt);
  const hue1 = h % 360;
  const hue2 = (hue1 + 60 + (h % 120)) % 360;
  const label = prompt.split(/[,:]/)[0]!.slice(0, 28);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="${label}">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="hsl(${hue1},70%,55%)"/><stop offset="1" stop-color="hsl(${hue2},70%,45%)"/>` +
    `</linearGradient></defs>` +
    `<rect width="600" height="300" rx="18" fill="url(#g)"/>` +
    `<circle cx="${120 + (h % 360)}" cy="150" r="70" fill="#ffffff" opacity="0.12"/>` +
    `<text x="300" y="160" text-anchor="middle" font-family="system-ui,sans-serif" font-size="26" fill="#ffffff" opacity="0.92">${escapeXml(label)}</text>` +
    `</svg>`;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" }[c]!));
}

function svgImage(prompt: string): GeneratedImage {
  const svg = deterministicSvg(prompt);
  const src = "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
  return { kind: "svg", svg, src, prompt };
}

/**
 * Generate an image for a prompt. Tries Higgsfield when HIGGSFIELD_API_KEY is
 * set; always falls back to a deterministic SVG so a real asset is guaranteed.
 */
export async function generateImage(prompt: string): Promise<GeneratedImage> {
  const key = process.env.HIGGSFIELD_API_KEY;
  if (key) {
    try {
      const res = await fetch(process.env.HIGGSFIELD_URL ?? "https://api.higgsfield.ai/v1/images", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: JSON.stringify({ prompt, size: "1024x576" }),
        signal: AbortSignal.timeout(Number(process.env.IMG_TIMEOUT_MS ?? "30000")),
      });
      if (res.ok) {
        const data = (await res.json()) as { url?: string; data?: { url?: string }[] };
        const url = data.url ?? data.data?.[0]?.url;
        if (url) return { kind: "url", src: url, prompt };
      }
    } catch {
      /* fall back to deterministic SVG */
    }
  }
  return svgImage(prompt);
}
