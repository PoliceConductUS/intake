import { parse as parseHtml } from "node-html-parser";
import { SOURCE_ID } from "../model.js";

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
  const seen = new Map<string, string>();
  let inMainSection = false;

  for (const node of content.querySelectorAll("div.mw-heading, ul")) {
    if (node.tagName === "DIV") {
      const heading = node.querySelector("h1, h2, h3, h4, h5, h6");
      if (!heading)
        throw new Error(
          `${SOURCE_ID}: heading block with no h1 to h6: ${cleanText(node.text)}`,
        );
      if (Number(heading.tagName.slice(1)) <= 2) {
        inMainSection = MAIN_SECTION.test(cleanText(node.text));
      }
      continue;
    }
    if (!inMainSection) continue;
    for (const item of node.querySelectorAll("li")) {
      const name = cleanText(item.querySelector("a")?.text ?? "");
      if (name === "") continue;
      const slug = slugify(name);
      const earlier = seen.get(slug);
      if (earlier !== undefined) {
        if (earlier !== name)
          throw new Error(
            `${SOURCE_ID}: agencies ${earlier} and ${name} share the slug ${slug}`,
          );
        continue;
      }
      seen.set(slug, name);
      agencies.push(name);
    }
  }

  return { agencies };
}
