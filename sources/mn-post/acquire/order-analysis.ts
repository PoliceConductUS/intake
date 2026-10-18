import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import {
  OrderAnalysisResultSchema,
  ORDER_ANALYSIS_PROMPT_VERSION,
} from "./document-evidence.js";
export { ORDER_ANALYSIS_PROMPT_VERSION } from "./document-evidence.js";
import type {
  OrderAnalysisResult,
  OrderAnalyzer,
} from "./collect-documents.js";

export const ORDER_ANALYSIS_MODEL = "claude-opus-5";
export const ORDER_ANALYSIS_INSTRUCTIONS = `You read disciplinary documents published by the Minnesota Board of Peace Officer Standards and Training (POST) — stipulation and consent orders (SACO) and board orders — and report what the document says about the officer's discipline.

Use the document's own words: quote it or condense it closely. Do not add, infer, or soften facts, and do not editorialize. The text was extracted by OCR, so ignore scanning artifacts and signature-page noise.

Return { analysis: { allegation, violation, finding, chief_action, sanction }, absenceReasons: { ... } }.
Each narrative must be a nonblank string or null. For every null narrative, absenceReasons must contain that field with a nonblank, field-specific explanation of what the document does not state. Do not put populated fields in absenceReasons. Explicit reasons record your assessment; they do not establish its correctness.

- allegation: the expressly stated factual basis for the action, preserving attribution. Include an expressly stated conviction (named OR unnamed felony), failure to report, fee, continuing-education, or tax basis even if the underlying incident is not described. For an unnamed conviction, state the attributed conviction and that the offense/underlying conduct is unspecified; do not return null solely because the incident is absent. Do not invent conduct or label a conviction as a mere allegation when the document states it as a conviction.
- violation: the statutes and rules the document cites as violated (for example "Minn. Stat. § 626.8432, subd. 1(a)(4); Minn. R. 6700.1600, subp. 1.A(4)").
- finding: the findings of fact and conclusions of law, condensed in the document's language. Preserve whether a statement is a Board finding, an officer's stipulation/admission, or an allegation; do not turn one into another.
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
    promptVersion: ORDER_ANALYSIS_PROMPT_VERSION,
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
