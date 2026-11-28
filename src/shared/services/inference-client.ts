import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";
import type { CallOutcome, CallRequest } from "../io/CallResult.js";
import {
  createServiceClientBase,
  retryAfterSeconds,
  type CallAttempt,
  type ClientDeps,
  type ItemFailure,
  type ServiceSkips,
} from "./client-base.js";

export type InferenceEffort = "low" | "medium" | "high" | "xhigh" | "max";

export type StructuredAnswerInput<Schema extends z.ZodType> = {
  model: string;
  prompt: string;
  text: string;
  inputName: string;
  schema: Schema;
  maxTokens: number;
  effort?: InferenceEffort;
};

export type InferenceResult<T> =
  | { status: "succeeded"; value: T; model: string; outcome: CallOutcome }
  | { status: "failed"; error: ItemFailure; outcome: CallOutcome }
  | { status: "skipped"; service: string; retryAfter: string };

export type InferenceClient = {
  structuredAnswer<Schema extends z.ZodType>(
    input: StructuredAnswerInput<Schema>,
  ): Promise<InferenceResult<z.infer<Schema>>>;
  skips(): ServiceSkips[];
};

export function structuredAnswerRequest(
  input: StructuredAnswerInput<z.ZodType>,
): CallRequest {
  return {
    service: "anthropic",
    operation: "messages",
    parameters: {
      maxTokens: input.maxTokens,
      ...(input.effort === undefined ? {} : { effort: input.effort }),
      outputSchema: zodOutputFormat(input.schema).schema,
    },
    prompt: input.prompt,
    inputs: [
      {
        name: input.inputName,
        sha256: createHash("sha256").update(input.text).digest("hex"),
      },
    ],
  };
}

function outage(
  error: unknown,
  now: Date,
  requestedModel: string,
): CallAttempt | undefined {
  if (error instanceof Anthropic.APIConnectionError)
    return {
      kind: "outage",
      requestedModel,
      message: `no answer from Anthropic (${error.message})`,
    };
  if (
    error instanceof Anthropic.APIError &&
    typeof error.status === "number" &&
    (error.status === 429 || error.status >= 500)
  ) {
    const seconds =
      error.headers === undefined
        ? undefined
        : retryAfterSeconds(error.headers, now);
    return {
      kind: "outage",
      requestedModel,
      message: `HTTP ${error.status} from Anthropic`,
      httpStatus: error.status,
      ...(seconds === undefined ? {} : { retryAfterSeconds: seconds }),
    };
  }
  return undefined;
}

export function createInferenceClient(
  deps: ClientDeps & {
    readApiKey: () => string | undefined;
    fetch?: typeof fetch;
    timeoutMs?: number;
  },
): InferenceClient {
  let anthropic: Anthropic | undefined;

  const base = createServiceClientBase({
    ...deps,
    service: "anthropic",
    check: async () => {
      const apiKey = deps.readApiKey()?.trim();
      if (apiKey === undefined || apiKey === "")
        return { ok: false, reason: "ANTHROPIC_API_KEY is not set" };
      anthropic = new Anthropic({
        apiKey,
        maxRetries: 0,
        timeout: deps.timeoutMs ?? 600_000,
        ...(deps.fetch === undefined ? {} : { fetch: deps.fetch }),
      });
      try {
        await anthropic.models.list({ limit: 1 });
        return { ok: true };
      } catch (error) {
        if (
          error instanceof Anthropic.AuthenticationError ||
          error instanceof Anthropic.PermissionDeniedError
        )
          return {
            ok: false,
            reason: `Anthropic rejected ANTHROPIC_API_KEY (HTTP ${error.status})`,
          };
        if (error instanceof Anthropic.APIConnectionError)
          return {
            ok: false,
            reason: `no answer from Anthropic (${error.message})`,
          };
        if (error instanceof Anthropic.APIError)
          return { ok: false, reason: `HTTP ${error.status} from Anthropic` };
        throw error;
      }
    },
  });

  async function ask(
    input: StructuredAnswerInput<z.ZodType>,
  ): Promise<CallAttempt> {
    let message: Anthropic.Message;
    let requestId: string | null | undefined;
    try {
      ({ data: message, request_id: requestId } = await anthropic!.messages
        .create({
          model: input.model,
          max_tokens: input.maxTokens,
          system: input.prompt,
          messages: [{ role: "user", content: input.text }],
          output_config: {
            format: zodOutputFormat(input.schema),
            ...(input.effort === undefined ? {} : { effort: input.effort }),
          },
        })
        .withResponse());
    } catch (error) {
      const down = outage(error, deps.now(), input.model);
      if (down !== undefined) return down;
      if (error instanceof Anthropic.APIError)
        return {
          kind: "item-failure",
          requestedModel: input.model,
          message: `HTTP ${error.status} from Anthropic: ${error.message}`,
          ...(typeof error.status === "number"
            ? { httpStatus: error.status }
            : {}),
          ...(error.requestID ? { requestId: error.requestID } : {}),
        };
      throw error;
    }
    const asked = {
      httpStatus: 200,
      requestedModel: input.model,
      ...(requestId ? { requestId } : {}),
    };
    if (typeof message.model !== "string" || message.model === "")
      return {
        kind: "item-failure",
        message: "The response names no model.",
        ...asked,
      };
    const facts = {
      ...asked,
      model: message.model,
      ...(message.stop_reason ? { stopReason: message.stop_reason } : {}),
      usage: { ...message.usage } as Record<string, unknown>,
    };
    if (message.stop_reason !== "end_turn") {
      const category =
        message.stop_reason === "refusal" && message.stop_details?.category
          ? ` (${message.stop_details.category})`
          : "";
      return {
        kind: "item-failure",
        message: `The model stopped with ${message.stop_reason}${category} and gave no usable answer.`,
        ...facts,
      };
    }
    const text = message.content
      .flatMap((block) => (block.type === "text" ? [block.text] : []))
      .join("");
    let answer: unknown;
    try {
      answer = JSON.parse(text);
    } catch {
      return {
        kind: "item-failure",
        message: "The model's answer is not JSON.",
        ...facts,
      };
    }
    const parsed = input.schema.safeParse(answer);
    if (!parsed.success)
      return {
        kind: "item-failure",
        message: `The model's answer does not fit the schema: ${parsed.error.issues[0]?.message ?? "invalid"}.`,
        ...facts,
      };
    return { kind: "response", response: parsed.data, ...facts };
  }

  return {
    async structuredAnswer(input) {
      const result = await base.cachedCall(structuredAnswerRequest(input), () =>
        ask(input),
      );
      if (result.status !== "succeeded") return result;
      if (result.outcome.model === undefined)
        throw new Error(
          "A succeeded anthropic outcome does not name the model that answered.",
        );
      return {
        status: "succeeded",
        value: input.schema.parse(await base.jsonResponse(result.outcome)),
        model: result.outcome.model,
        outcome: result.outcome,
      };
    },
    skips: () => {
      const skips = base.skips();
      return skips === undefined ? [] : [skips];
    },
  };
}
