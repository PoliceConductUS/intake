import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseDocument, stringify } from "yaml";
import { yamlDigest } from "../resource.js";

export function parseYamlDocument(
  filePath: string,
  contents: string,
  label: string,
): unknown {
  try {
    const document = parseDocument(contents, { prettyErrors: false });
    if (document.errors.length > 0) {
      throw document.errors[0];
    }
    return document.toJSON();
  } catch (error) {
    const message = error instanceof Error ? `: ${error.message}` : "";
    throw new Error(`${label} YAML is malformed: ${filePath}${message}`);
  }
}

export async function readYamlDocumentFile(
  filePath: string,
  label: string,
): Promise<{ contents: string; document: unknown }> {
  let documentStat;
  try {
    documentStat = await stat(filePath);
  } catch {
    throw new Error(`${label} is not readable: ${filePath}`);
  }

  if (!documentStat.isFile()) {
    throw new Error(`${label} is not a file: ${filePath}`);
  }

  let contents;
  try {
    contents = await readFile(filePath, "utf8");
  } catch {
    throw new Error(`${label} is not readable: ${filePath}`);
  }

  return {
    contents,
    document: parseYamlDocument(filePath, contents, label),
  };
}

export async function writeYamlDocumentFile(
  filePath: string,
  value: unknown,
): Promise<string> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const contents = stringify(value);
  await writeFile(filePath, contents, "utf8");
  return contents;
}

export async function readYamlDocumentDigest(
  filePath: string,
  label: string,
): Promise<string> {
  const { contents } = await readYamlDocumentFile(filePath, label);
  return `sha256:${yamlDigest(contents)}`;
}
