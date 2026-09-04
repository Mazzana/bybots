import { describe, expect, it, vi } from "vitest";
import { HermesClient } from "../server/hermes-client";

describe("Hermes usage", () => {
  it("returns tokens and spend for one bot without estimating client-side", async () => {
    const fetcher = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          totals: {
            total_input: 1200,
            total_output: 300,
            total_reasoning: 100,
            total_cache_read: 800,
            total_actual_cost: 0.21,
            total_estimated_cost: 0.24,
            total_sessions: 4,
            total_api_calls: 8
          },
          by_model: [{ model: "gpt-5", input_tokens: 1200, output_tokens: 300, estimated_cost: 0.24, sessions: 4, api_calls: 8 }],
          daily: [],
          period_days: 30,
          skills: { summary: {}, top_skills: [] }
        }),
        { status: 200 }
      )
    );
    const client = new HermesClient({ baseUrl: "http://127.0.0.1:9119", fetcher });

    await expect(client.getBotUsage("finance", 30)).resolves.toMatchObject({
      bot: "finance",
      inputTokens: 1200,
      outputTokens: 300,
      reasoningTokens: 100,
      cacheReadTokens: 800,
      totalTokens: 1600,
      actualCostUsd: 0.21,
      estimatedCostUsd: 0.24,
      sessions: 4,
      apiCalls: 8
    });
    expect(fetcher).toHaveBeenCalledWith(
      "http://127.0.0.1:9119/api/analytics/usage?days=30&profile=finance",
      expect.objectContaining({ method: "GET" })
    );
  });
});
