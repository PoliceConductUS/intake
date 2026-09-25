import { parse as parseHtml } from "node-html-parser";

export type FederalLeList = {
  agencies: string[];
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const MAIN_SECTION =
  /^list of (united states )?federal law enforcement agencies/i;

function cleanText(value: string): string {
  return value
    .replace(/\[edit\]/gi, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFederalLeAgencies(html: string): FederalLeList {
  const root = parseHtml(html);
  const content = root.querySelector("#mw-content-text") ?? root;
  const agencies: string[] = [];
  const seen = new Set<string>();
  let inMainSection = false;

  for (const node of content.querySelectorAll("div.mw-heading, ul")) {
    if ((node.getAttribute("class") ?? "").includes("mw-heading")) {
      const heading = node.querySelector("h1, h2, h3, h4, h5, h6");
      const level = heading ? Number(heading.tagName.slice(1)) : 0;
      if (level <= 2) {
        inMainSection = MAIN_SECTION.test(cleanText(node.text));
      }
      continue;
    }
    if (!inMainSection) continue;
    for (const item of node.querySelectorAll("li")) {
      const name = cleanText(item.querySelector("a")?.text ?? "");
      if (name === "") continue;
      const slug = slugify(name);
      if (seen.has(slug)) continue;
      seen.add(slug);
      agencies.push(name);
    }
  }

  return { agencies };
}
