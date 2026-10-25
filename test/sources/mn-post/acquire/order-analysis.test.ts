import { expect, it, vi } from "vitest";
import {
  createOrderAnalyzer,
  ORDER_ANALYSIS_INSTRUCTIONS,
  ORDER_ANALYSIS_PROMPT_VERSION,
} from "../../../../sources/mn-post/acquire/order-analysis.js";
const { parse } = vi.hoisted(() => ({ parse: vi.fn() }));
vi.mock("@anthropic-ai/sdk", () => ({
  default: class {
    beta = { messages: { parse } };
  },
}));
it("requests structured narratives and separate absence reasons under prompt2", async () => {
  const result = {
    analysis: {
      allegation:
        "The Board states the officer was convicted of a felony; the offense and underlying incident are not specified.",
      violation: null,
      finding: null,
      chief_action: null,
      sanction: "Suspended.",
    },
    absenceReasons: {
      violation: "The text cites no violation.",
      finding: "The text states no Board finding or stipulation.",
      chief_action: "The text describes no employer response.",
    },
  };
  parse.mockImplementationOnce(async (input) => ({
    stop_reason: "end_turn",
    parsed_output: input.output_config.format.parse(JSON.stringify(result)),
  }));
  expect(await createOrderAnalyzer("test").analyze("Order text")).toEqual(
    result,
  );
  const input = parse.mock.calls.at(-1)![0];
  expect(input.system).toBe(ORDER_ANALYSIS_INSTRUCTIONS);
  expect(input.messages).toEqual([{ role: "user", content: "Order text" }]);
  expect(ORDER_ANALYSIS_PROMPT_VERSION).toBe(2);
});
it("rejects automated parsed output missing a null justification", async () => {
  parse.mockResolvedValueOnce({
    stop_reason: "end_turn",
    parsed_output: {
      analysis: {
        allegation: null,
        violation: null,
        finding: null,
        chief_action: null,
        sanction: null,
      },
      absenceReasons: {},
    },
  });
  await expect(
    createOrderAnalyzer("test").analyze("Order text"),
  ).rejects.toThrow(/absenceReasons/);
});
it("rejects explicit undefined instead of counting it as a null-field reason", async () => {
  parse.mockResolvedValueOnce({
    stop_reason: "end_turn",
    parsed_output: {
      analysis: {
        allegation: null,
        violation: "Rule",
        finding: "Finding",
        chief_action: "Action",
        sanction: "Sanction",
      },
      absenceReasons: { allegation: undefined },
    },
  });
  await expect(
    createOrderAnalyzer("test").analyze("Order text"),
  ).rejects.toThrow(/allegation/);
});
