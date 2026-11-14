import { expect, it } from "vitest";
import { chromium } from "playwright";
import { searchGoogleNews } from "../../../sources/org.policeconduct.local-news/browser.js";

it("waits for Google verification and resumes the same query in the same tab", async () => {
  const browser = await chromium.launch({ channel: "chrome" });
  try {
    const page = await browser.newPage();
    const query = "Example Officer Example Agency";
    const url =
      "https://www.google.com/search?" +
      new URLSearchParams({ q: query, tbm: "nws", tbs: "qdr:w" });
    let verified = false;
    const requests: string[] = [];
    await page.route("https://www.google.com/**", async (route) => {
      const path = new URL(route.request().url()).pathname;
      requests.push(path);
      if (path === "/search" && !verified)
        return route.fulfill({
          contentType: "text/html",
          body: '<script>history.replaceState(null, "", "/sorry/index")</script><p>Unusual traffic</p>',
        });
      const body = `
        <a href="/preferences"><h3>Preferences</h3></a>
        <a class="WlydOe" href="https://publisher.example/story">Article</a>
        <a href="/url?url=https%3A%2F%2Fsecond.example%2Fcopy"><div role="heading">Copy</div></a>
        <a href="https://publisher.example/story"><h3>Article again</h3></a>
        <a id="pnnext" href="/search?start=10">Next</a>
      `;
      await route.fulfill({ contentType: "text/html", body });
    });
    let notify!: () => void;
    const waiting = new Promise<void>((resolve) => {
      notify = resolve;
    });
    const search = searchGoogleNews(page, query, undefined, notify);
    await Promise.race([
      waiting,
      search.then(() => {
        throw Error("Search did not wait for verification");
      }),
    ]);
    expect(new URL(page.url()).pathname).toBe("/sorry/index");
    verified = true;
    await page.goto(url);
    expect(await search).toEqual({
      urls: ["https://publisher.example/story", "https://second.example/copy"],
      nextPage: "https://www.google.com/search?start=10",
    });
    expect(requests.filter((path) => path === "/search")).toHaveLength(2);
  } finally {
    await browser.close();
  }
});
