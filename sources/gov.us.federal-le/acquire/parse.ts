import { parse as parseHtml } from "node-html-parser";

export type FederalParent = {
  name: string;
  slug: string;
  agencies: string[];
};

export type FederalLeList = {
  parents: FederalParent[];
};

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const PARENT_HEADING = /^(department|office|u\.?s\.?|united states|the )/i;
const NON_PARENT_HEADING =
  /^(see also|references|external links|notes|further reading|contents|history)/i;

function cleanText(value: string): string {
  return value
    .replace(/\[\d+\]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseFederalLeAgencies(html: string): FederalLeList {
  const root = parseHtml(html);
  const content = root.querySelector("#mw-content-text") ?? root;
  const parents: FederalParent[] = [];
  let current: FederalParent | undefined;

  for (const node of content.querySelectorAll("h2, h3, ul")) {
    if (node.tagName === "H2" || node.tagName === "H3") {
      const heading = cleanText(node.text);
      if (heading === "" || NON_PARENT_HEADING.test(heading)) {
        current = undefined;
        continue;
      }
      if (!PARENT_HEADING.test(heading)) {
        current = undefined;
        continue;
      }
      current = { name: heading, slug: slugify(heading), agencies: [] };
      parents.push(current);
      continue;
    }
    if (current === undefined) continue;
    for (const item of node.querySelectorAll("li")) {
      const link = item.querySelector("a");
      const name = cleanText(link?.text ?? item.text);
      if (name !== "") current.agencies.push(name);
    }
  }

  return { parents: parents.filter((parent) => parent.agencies.length > 0) };
}
