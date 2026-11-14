import { errors, type Page, type Response } from "playwright";

const verification =
  'form[action*="sorry"], iframe[src*="recaptcha"], #captcha-form';
const resultLinks =
  '[data-news-doc-id] a[href], a.WlydOe[href], a[href]:has(h3), a[href]:has([role="heading"])';

function readSearchPage(selectors: {
  verification: string;
  resultLinks: string;
}) {
  if (
    location.pathname.startsWith("/sorry/") ||
    document.querySelector(selectors.verification)
  ) {
    return { kind: "verification" as const };
  }
  if (location.pathname !== "/search" || document.readyState === "loading")
    return null;
  const urls = new Set<string>();
  for (const link of Array.from(
    document.querySelectorAll<HTMLAnchorElement>(selectors.resultLinks),
  )) {
    let url = new URL(link.href);
    if (url.origin === location.origin && url.pathname === "/url") {
      const target = url.searchParams.get("q") ?? url.searchParams.get("url");
      if (!target || !URL.canParse(target)) continue;
      url = new URL(target);
    }
    const newsRedirect =
      url.pathname === "/goto" &&
      url.searchParams.has("url") &&
      link.closest("[data-news-doc-id]");
    if (
      (url.origin !== location.origin || newsRedirect) &&
      ["https:", "http:"].includes(url.protocol)
    )
      urls.add(url.href);
  }
  if (
    !urls.size &&
    !/did not match any|no (?:news )?results (?:found|for)|there (?:aren't|aren’t|are no) (?:any )?(?:news )?results/i.test(
      document.body.innerText,
    )
  )
    return null;
  const next = document.querySelector<HTMLAnchorElement>(
    'a#pnnext, a[aria-label="Next page"], a[rel="next"]',
  );
  return { kind: "results" as const, urls: [...urls], nextPage: next?.href };
}

export async function searchGoogleNews(
  page: Page,
  query: string,
  nextPage?: string,
  log?: (message: string) => void,
) {
  const url =
    nextPage ??
    "https://www.google.com/search?" +
      new URLSearchParams({ q: query, tbm: "nws", tbs: "qdr:w" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  let timeout = 10000;
  for (;;) {
    let state;
    try {
      const handle = await page.waitForFunction(
        readSearchPage,
        { verification, resultLinks },
        { polling: 500, timeout },
      );
      state = await handle.jsonValue();
      await handle.dispose();
    } catch (error) {
      if (!(error instanceof errors.TimeoutError)) throw error;
      const detail = await page.evaluate(() => ({
        path: location.pathname,
        title: document.title,
        links: document.links.length,
        resultAnchors: document.querySelectorAll("#rso a, #search a").length,
      }));
      await page.bringToFront();
      log?.(
        "Waiting in the open Chrome tab for search results for " +
          query +
          ": " +
          JSON.stringify(detail),
      );
      timeout = 0;
      continue;
    }
    if (!state) continue;
    if (state.kind === "results")
      return { urls: state.urls, nextPage: state.nextPage };
    await page.bringToFront();
    log?.(
      "Complete Google verification in the open Chrome tab to continue: " +
        query,
    );
    await page.waitForFunction(
      (selector) =>
        !location.pathname.startsWith("/sorry/") &&
        !document.querySelector(selector),
      verification,
      { timeout: 0, polling: 500 },
    );
  }
}

export async function openPublisher(
  page: Page,
  url: string,
  log?: (message: string) => void,
) {
  const link = new URL(url);
  if (link.hostname !== "www.google.com" || link.pathname !== "/goto")
    return page.goto(url, { waitUntil: "domcontentloaded" });

  let publisher: Response | null = null;
  function rememberNavigation(response: Response) {
    const request = response.request();
    if (
      request.isNavigationRequest() &&
      request.frame() === page.mainFrame() &&
      new URL(response.url()).origin !== link.origin
    )
      publisher = response;
  }
  page.on("response", rememberNavigation);
  try {
    await page.goto(url, { waitUntil: "domcontentloaded" });
    if (
      new URL(page.url()).origin === link.origin &&
      (new URL(page.url()).pathname.startsWith("/sorry/") ||
        (await page.locator(verification).count()))
    ) {
      await page.bringToFront();
      log?.(
        "Complete Google verification in the open Chrome tab to continue to the publisher.",
      );
      await page.waitForFunction(
        (selector) =>
          !location.pathname.startsWith("/sorry/") &&
          !document.querySelector(selector),
        verification,
        { timeout: 0, polling: 500 },
      );
    }
    await page.waitForURL((destination) => destination.origin !== link.origin, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    return publisher;
  } finally {
    page.off("response", rememberNavigation);
  }
}
