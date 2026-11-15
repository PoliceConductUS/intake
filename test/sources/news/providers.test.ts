import { expect, it, vi } from "vitest";
import { newsResults } from "../../../sources/com/serpapi/landing-page-search/providers.js";
it("uses the provider's next-page offset when a sparse organic results page has fewer links", async () => {
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        plan_monthly_price: 0,
        plan_searches_left: 3,
        this_hour_searches: 0,
        account_rate_limit_per_hour: 10,
      }),
    )
    .mockResolvedValueOnce(
      Response.json({
        organic_results: [{ link: "https://story.example/test" }],
        serpapi_pagination: {
          next: "https://serpapi.com/search.json?engine=google&start=10",
        },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  try {
    expect(await newsResults("search", 0, "fixture")).toEqual({
      urls: ["https://story.example/test"],
      nextStart: 10,
      response: expect.objectContaining({
        organic_results: [{ link: "https://story.example/test" }],
      }),
    });
  } finally {
    vi.unstubAllGlobals();
  }
});

it("makes no news request once the free account allowance is exhausted", async () => {
  const fetch = vi.fn().mockResolvedValue(
    Response.json({
      plan_monthly_price: 0,
      plan_searches_left: 0,
      this_hour_searches: 1,
      account_rate_limit_per_hour: 10,
    }),
  );
  vi.stubGlobal("fetch", fetch);
  try {
    await expect(newsResults("search", 0, "fixture")).rejects.toThrow(
      "Free search allowance",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
