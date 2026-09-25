import path from "node:path";

// The shared read-ref shape and path resolution every envelope reader uses: an
// envelope is read either from a direct path or from a `{ ref: { path, kind, sha256 } }`
// (a chunk pointer). The only per-envelope difference is the kind name used in error
// messages, passed as `defaultKind`.
export type EnvelopeReadRef =
  | { path: string; kind?: string; sha256?: string }
  | { ref: { path: string; kind?: string; sha256?: string } };

export type EnvelopeReadOptions = {
  expectedNamespace?: string;
  relativeTo?: string;
};

export function refValue(pathOrRef: string | EnvelopeReadRef): {
  path: string;
  kind?: string;
  sha256?: string;
} {
  if (typeof pathOrRef === "string") {
    return { path: pathOrRef };
  }
  if ("ref" in pathOrRef) {
    return pathOrRef.ref;
  }
  return pathOrRef;
}

export function resolveReadPath(
  pathOrRef: string | EnvelopeReadRef,
  options: EnvelopeReadOptions,
  defaultKind: string,
): { filePath: string; kind?: string; sha256?: string } {
  const ref = refValue(pathOrRef);
  if (typeof pathOrRef === "string" || path.isAbsolute(ref.path)) {
    return { ...ref, filePath: ref.path };
  }
  if (
    options.relativeTo === undefined ||
    options.relativeTo.trim().length === 0
  ) {
    throw new Error(
      `Relative ${ref.kind ?? defaultKind} ref requires relativeTo.`,
    );
  }

  const baseDirectory = path.dirname(options.relativeTo);
  const resolvedPath = path.resolve(baseDirectory, ref.path);
  const relativePath = path.relative(baseDirectory, resolvedPath);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(
      `${ref.kind ?? defaultKind} ref.path escapes its directory: ${ref.path}`,
    );
  }
  return { ...ref, filePath: resolvedPath };
}
