import { expect, it } from "vitest";
import {
  domainRankFor,
  readDomainRanks,
} from "../../../sources/lib/news-ranks.js";
it("uses Common Crawl's domain rank for a publisher subdomain", async () => {
  async function* snapshot() {
    yield "#harmonicc_pos\t#harmonicc_val\t#pr_pos\t#pr_val\t#host_rev\t#n_hosts";
    yield "15\t123\t7\t0.02\tuk.co.example\t5";
  }
  const ranks = await readDomainRanks(snapshot(), ["local.example.co.uk"]);
  expect(domainRankFor("https://news.example.co.uk/story", ranks)).toBe(15);
  expect(domainRankFor("https://another.example/story", ranks)).toBeUndefined();
});
