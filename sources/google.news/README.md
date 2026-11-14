# Daily personnel news

The scheduled workflow in this repository reads finalized Search Console query and landing-page rows and looks for the first qualifying news story for each individual personnel profile. It publishes full pages in the selected website release. Permanent import is a separate Intake operation using the `org.policeconduct.release-news` source.

## Activation

After the website release and its public/private access checks have been verified, configure the repository variables and secrets listed in `.github/workflows/discover-news.yml`. Set the release function variable last to enable the scheduled job. The workflow runs at 7 a.m. Chicago time. A manual dispatch uses the same production publication path.

Use a Search Console service account with read access to the configured property, a free SerpApi key, and an inference endpoint that accepts OpenAI-compatible chat completions. The website infrastructure provides the private artifact bucket, site bucket, publisher role and release function. Keep query matches, saved bodies, selectors and paragraph records in private storage.

## Publisher ranks

Download a Common Crawl **domain** ranking snapshot. Build a compact JSON lookup for the publisher hostnames you want to rank. The lookup uses the harmonic centrality position of their registered domain. Hosts without a rank use the remaining source-selection rules.

```sh
npx tsx sources/lib/news-ranks.ts domain-ranks.txt.gz news.example.org > domain-ranks.json
```

For local discovery set `NEWS_DOMAIN_RANKS` to the lookup file. For hosted discovery store the JSON at `news-discovery/domain-ranks.json` in the private bucket. [Common Crawl ranking downloads](https://index.commoncrawl.org/web-graphs-index.html)
