import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { OrderAnalysisResultSchema } from "./document-evidence.js";
import {
  ORDER_ANALYSIS_INSTRUCTIONS,
  ORDER_ANALYSIS_PROMPT_SHA256,
} from "./order-prompt.js";
export {
  ORDER_ANALYSIS_INSTRUCTIONS,
  ORDER_ANALYSIS_PROMPT_SHA256,
} from "./order-prompt.js";
import type {
  OrderAnalysisResult,
  OrderAnalyzer,
} from "./collect-documents.js";

export const ORDER_ANALYSIS_MODEL = "claude-opus-5";

/**
 * The Claude analysis of one order's text (structured output). Non-deterministic
 * and networked, so it runs only in acquire and is cached there by document
 * hash; the transform reads the cached result.
 */
export function createOrderAnalyzer(apiKey: string): OrderAnalyzer {
  const client = new Anthropic({ apiKey });
  return {
    model: ORDER_ANALYSIS_MODEL,
    promptSha256: ORDER_ANALYSIS_PROMPT_SHA256,
    async analyze(text: string): Promise<OrderAnalysisResult> {
      const response = await client.beta.messages.parse({
        model: ORDER_ANALYSIS_MODEL,
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: ORDER_ANALYSIS_INSTRUCTIONS,
        messages: [{ role: "user", content: text }],
        output_config: { format: zodOutputFormat(OrderAnalysisResultSchema) },
      });
      if (response.stop_reason === "refusal") {
        throw new Error(
          `mn-post: the order analysis was refused (${response.stop_details?.category ?? "no category"}).`,
        );
      }
      const output = response.parsed_output;
      if (output === null) {
        throw new Error(
          "mn-post: the order analysis did not return the expected structure.",
        );
      }
      return OrderAnalysisResultSchema.parse(output);
    },
  };
}

/** The analyzer used until the first order needs analyzing; keyless runs that hit only the cache never fail. */
export function createLazyOrderAnalyzer(
  apiKey: string | undefined,
): OrderAnalyzer {
  let analyzer: OrderAnalyzer | undefined;
  return {
    model: ORDER_ANALYSIS_MODEL,
    promptSha256: ORDER_ANALYSIS_PROMPT_SHA256,
    analyze(text: string): Promise<OrderAnalysisResult> {
      if (analyzer === undefined) {
        if (apiKey === undefined || apiKey.trim() === "") {
          throw new Error(
            "mn-post: ANTHROPIC_API_KEY is required to analyze disciplinary orders.",
          );
        }
        analyzer = createOrderAnalyzer(apiKey);
      }
      return analyzer.analyze(text);
    },
  };
}
