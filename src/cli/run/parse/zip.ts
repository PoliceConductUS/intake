import yauzl from "yauzl";

/**
 * The only file in the codebase permitted to import `yauzl`. Wraps its
 * callback/event-based API in Promises so the rest of the runtime can read
 * zip archives (pipe-delimited text and shapefiles) without depending on
 * the underlying zip library directly.
 */

function openZip(zipPath: string): Promise<yauzl.ZipFile> {
  return new Promise((resolve, reject) => {
    yauzl.open(zipPath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);
      if (!zipfile) return reject(new Error(`Failed to open zip: ${zipPath}`));
      resolve(zipfile);
    });
  });
}

/**
 * yauzl's default `autoClose` only closes the underlying file descriptor on
 * the `"end"` event, never on `"error"`. Without this, a corrupt central
 * directory (or any mid-iteration failure) leaks the fd. Centralized here so
 * every zipfile consumer closes-then-rejects the same way.
 */
function onZipError(
  zipfile: yauzl.ZipFile,
  reject: (err: Error) => void,
): void {
  zipfile.on("error", (err: Error) => {
    zipfile.close();
    reject(err);
  });
}

function readEntryBuffer(
  zipfile: yauzl.ZipFile,
  entry: yauzl.Entry,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    zipfile.openReadStream(entry, (err, stream) => {
      if (err) return reject(err);
      if (!stream)
        return reject(
          new Error(`Failed to open read stream for entry: ${entry.fileName}`),
        );
      const chunks: Buffer[] = [];
      stream.on("data", (chunk: Buffer) => chunks.push(chunk));
      stream.on("end", () => resolve(Buffer.concat(chunks)));
      stream.on("error", reject);
    });
  });
}

/**
 * Lists the file names of every entry in a zip archive, in the archive's
 * internal order. Deterministic: reads only, no clock or randomness.
 */
export async function listZipEntries(zipPath: string): Promise<string[]> {
  const zipfile = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    const names: string[] = [];
    zipfile.on("entry", (entry: yauzl.Entry) => {
      names.push(entry.fileName);
      zipfile.readEntry();
    });
    zipfile.on("end", () => resolve(names));
    onZipError(zipfile, reject);
    zipfile.readEntry();
  });
}

/**
 * Reads a single entry's raw bytes from a zip archive. Rejects clearly if
 * no entry with that name exists in the archive.
 */
export async function readZipEntryBuffer(
  zipPath: string,
  entryName: string,
): Promise<Buffer> {
  const zipfile = await openZip(zipPath);
  return new Promise((resolve, reject) => {
    let found = false;
    zipfile.on("entry", (entry: yauzl.Entry) => {
      if (entry.fileName !== entryName) {
        zipfile.readEntry();
        return;
      }
      found = true;
      readEntryBuffer(zipfile, entry)
        .then((buf) => {
          zipfile.close();
          resolve(buf);
        })
        .catch((err) => {
          zipfile.close();
          reject(err);
        });
    });
    zipfile.on("end", () => {
      if (!found) {
        zipfile.close();
        reject(new Error(`Entry "${entryName}" not found in zip: ${zipPath}`));
      }
    });
    onZipError(zipfile, reject);
    zipfile.readEntry();
  });
}

/**
 * Reads a single entry's bytes from a zip archive as UTF-8 text.
 */
export async function readZipEntryText(
  zipPath: string,
  entryName: string,
): Promise<string> {
  const buf = await readZipEntryBuffer(zipPath, entryName);
  return buf.toString("utf8");
}
