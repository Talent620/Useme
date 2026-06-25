// Generic LLM completion helper. Returns text, or null when no API key / on
// error — so every caller has a deterministic fallback and the system never
// hard-depends on the model being reachable. This is the "amplifier" layer.

export interface CompleteOptions {
  temperature?: number;
  maxTokens?: number;
  json?: boolean;
}

export async function complete(
  system: string,
  user: string,
  opts: CompleteOptions = {},
): Promise<string | null> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(Number(process.env.LLM_TIMEOUT_MS ?? "40000")),
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL ?? "gpt-4o-mini",
        temperature: opts.temperature ?? 0.4,
        max_tokens: opts.maxTokens ?? 1500,
        ...(opts.json ? { response_format: { type: "json_object" } } : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content ?? null;
  } catch {
    return null;
  }
}

export function llmAvailable(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}
