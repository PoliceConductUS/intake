import { expect, it, vi } from "vitest";
import { newsResults } from "../../../sources/google.news/providers.js";
it("uses the provider's next-page offset when a sparse news page has fewer links", async () => {
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
        news_results: [{ link: "https://story.example/test" }],
        serpapi_pagination: {
          next: "https://serpapi.com/search.json?engine=google&start=10",
        },
      }),
    );
  vi.stubGlobal("fetch", fetch);
  try {
    expect(await newsResults("search", "person", 0, "fixture")).toEqual({
      urls: ["https://story.example/test"],
      nextStart: 10,
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
    await expect(newsResults("search", "person", 0, "fixture")).rejects.toThrow(
      "Free search allowance",
    );
    expect(fetch).toHaveBeenCalledTimes(1);
  } finally {
    vi.unstubAllGlobals();
  }
});
