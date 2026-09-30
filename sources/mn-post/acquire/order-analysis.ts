import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { OrderAnalysis, OrderAnalyzer } from "./collect-documents.js";

export const ORDER_ANALYSIS_MODEL = "claude-opus-5";
export const ORDER_ANALYSIS_PROMPT_VERSION = 1;

const field = z.string().nullable();
export const OrderAnalysisSchema = z.object({
  allegation: field,
  violation: field,
  finding: field,
  chief_action: field,
  sanction: field,
});

export const ORDER_ANALYSIS_INSTRUCTIONS = `You read disciplinary documents published by the Minnesota Board of Peace Officer Standards and Training (POST) — stipulation and consent orders (SACO) and board orders — and report what the document says about the officer's discipline.

Use the document's own words: quote it or condense it closely. Do not add, infer, or soften facts, and do not editorialize. The text was extracted by OCR, so ignore scanning artifacts and signature-page noise.

Every field is null when the document does not state it.

- allegation: the conduct the officer was alleged or stipulated to have engaged in — the factual basis for the action.
- violation: the statutes and rules the document cites as violated (for example "Minn. Stat. § 626.8432, subd. 1(a)(4); Minn. R. 6700.1600, subp. 1.A(4)").
- finding: the findings of fact and conclusions of law, condensed to a few sentences in the document's language.
- chief_action: what the officer's employing agency or chief law enforcement officer did in response — termination, suspension, unpaid leave, resignation in lieu of discipline, reprimand, training, and the like — as the document states it. null when the document does not describe any employer action.
- sanction: the sanction(s) the Board ordered on the officer's license — revocation, stayed revocation, suspension, censure, conditions — with their durations and conditions.`;

/**
 * The Claude analysis of one order's text (structured output). Non-deterministic
 * and networked, so it runs only in acquire and is cached there by document
 * hash; the transform reads the cached result.
 */
export function createOrderAnalyzer(apiKey: string): OrderAnalyzer {
  const client = new Anthropic({ apiKey });
  return {
    model: ORDER_ANALYSIS_MODEL,
    promptVersion: ORDER_ANALYSIS_PROMPT_VERSION,
    async analyze(text: string): Promise<OrderAnalysis> {
      const response = await client.beta.messages.parse({
        model: ORDER_ANALYSIS_MODEL,
        max_tokens: 4096,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        system: ORDER_ANALYSIS_INSTRUCTIONS,
        messages: [{ role: "user", content: text }],
        output_config: { format: zodOutputFormat(OrderAnalysisSchema) },
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
      return output;
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
    promptVersion: ORDER_ANALYSIS_PROMPT_VERSION,
    analyze(text: string): Promise<OrderAnalysis> {
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
