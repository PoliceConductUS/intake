import type { Page } from "playwright";

const verification =
  'form[action*="sorry"], iframe[src*="recaptcha"], #captcha-form';
const resultLinks =
  'a.WlydOe[href], a[href]:has(h3), a[href]:has([role="heading"])';
const noResults =
  /did not match|no (?:news )?results|there (?:aren't|aren’t|are no) (?:any )?results/i;

export async function searchGoogleNews(
  page: Page,
  query: string,
  nextPage?: string,
  onVerification?: (message: string) => void,
) {
  const url =
    nextPage ??
    "https://www.google.com/search?" +
      new URLSearchParams({ q: query, tbm: "nws", tbs: "qdr:w" });
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const challenge = await page.evaluate(
    (selector) =>
      location.pathname.startsWith("/sorry/") ||
      !!document.querySelector(selector),
    verification,
  );
  if (challenge) {
    await page.bringToFront();
    onVerification?.(
      "Complete Google verification in the open Chrome tab to continue: " +
        query,
    );
    await page.waitForFunction(
      (selector) =>
        location.pathname === "/search" && !document.querySelector(selector),
      verification,
      { timeout: 0 },
    );
    await page.waitForLoadState("domcontentloaded");
  }

  const links = await page
    .locator(resultLinks)
    .evaluateAll((nodes) =>
      nodes.map((node) => (node as HTMLAnchorElement).href),
    );
  const searchOrigin = new URL(page.url()).origin;
  const urls = new Set<string>();
  for (const href of links) {
    let address = new URL(href);
    if (address.origin === searchOrigin && address.pathname === "/url") {
      const target =
        address.searchParams.get("q") ?? address.searchParams.get("url");
      if (!target || !URL.canParse(target)) continue;
      address = new URL(target);
    }
    if (
      address.origin !== searchOrigin &&
      ["https:", "http:"].includes(address.protocol)
    )
      urls.add(address.href);
  }
  if (!urls.size && !noResults.test(await page.locator("body").innerText()))
    throw Error("Could not identify ranked search results for " + query);
  const next = await page
    .locator('a#pnnext, a[aria-label="Next page"], a[rel="next"]')
    .evaluateAll((nodes) => (nodes[0] as HTMLAnchorElement | undefined)?.href);
  return { urls: [...urls], nextPage: next };
}
