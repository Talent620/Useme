// Dynamic tool-composition layer. Instead of each executor hardcoding which
// tools to call, the orchestrator inspects the job + capability and assembles a
// ToolBundle from whichever registered tools apply — composing a solution the
// way an expert would. Executors then just consume the bundle.

import type { Capability, Job } from "./types.ts";
import { allUrls, fetchHtml, firstUrl } from "./tools/web.ts";
import { gatherSources, type Source } from "./tools/research.ts";
import { analyzeHtml, auditFindings, type SeoFinding, type SeoSignals } from "./tools/seo.ts";
import { generateImage, type GeneratedImage } from "./tools/image.ts";

export interface ToolBundle {
  research?: Source[];
  seo?: { signals: SeoSignals; findings: SeoFinding[]; url: string };
  image?: GeneratedImage;
}

interface Tool {
  name: string;
  applies(job: Job, capability: Capability): boolean;
  produce(job: Job): Promise<Partial<ToolBundle>>;
}

function heroPrompt(job: Job): string {
  return `${job.title}, ${job.categories.join(", ")}, nowoczesny gradient, czysty styl`;
}

export const TOOLS: Tool[] = [
  {
    name: "research",
    applies: (job, cap) => cap === "writer" && allUrls(job.brief).length > 0,
    produce: async (job) => ({ research: await gatherSources(allUrls(job.brief)) }),
  },
  {
    name: "seo",
    applies: (job, cap) => cap === "audit" && Boolean(firstUrl(job.brief)),
    produce: async (job) => {
      const url = firstUrl(job.brief)!;
      try {
        const signals = analyzeHtml(await fetchHtml(url), url.startsWith("file:") ? undefined : url);
        return { seo: { signals, findings: auditFindings(signals), url } };
      } catch {
        return {};
      }
    },
  },
  {
    name: "image",
    applies: (_job, cap) => cap === "landing",
    produce: async (job) => ({ image: await generateImage(heroPrompt(job)) }),
  },
];

/** Run every applicable tool and merge their outputs into one bundle. */
export async function gather(job: Job, capability: Capability): Promise<ToolBundle> {
  const bundle: ToolBundle = {};
  for (const tool of TOOLS) {
    if (tool.applies(job, capability)) {
      Object.assign(bundle, await tool.produce(job));
    }
  }
  return bundle;
}

/** Which tools would fire — for transparency/telemetry. */
export function planTools(job: Job, capability: Capability): string[] {
  return TOOLS.filter((t) => t.applies(job, capability)).map((t) => t.name);
}
