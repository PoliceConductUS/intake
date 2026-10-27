import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

function imageType(bytes: Buffer): { extension: string; contentType: string } {
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return { extension: "webp", contentType: "image/webp" };
  if (bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")))
    return { extension: "png", contentType: "image/png" };
  if (bytes.subarray(0, 3).equals(Buffer.from("ffd8ff", "hex")))
    return { extension: "jpg", contentType: "image/jpeg" };
  if (
    bytes.subarray(4, 8).toString() === "ftyp" &&
    bytes.subarray(8, 32).includes(Buffer.from("avif"))
  )
    return { extension: "avif", contentType: "image/avif" };
  throw new Error("Unsupported image bytes; use WebP, PNG, JPEG or AVIF.");
}

export async function storePersonnelPhoto(workspace: string, filename: string) {
  const bytes = await readFile(filename);
  const type = imageType(bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const workspacePath = `assets/PersonnelPhoto/${sha256}.${type.extension}`;
  const destination = path.join(workspace, workspacePath);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes);
  return {
    workspace_path: workspacePath,
    sha256,
    content_type: type.contentType,
    byte_size: bytes.length,
    source_filename: path.basename(filename),
  };
}
