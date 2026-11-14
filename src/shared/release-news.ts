export type SourceRef = { namespace: string; sourceId: string };
export type NewsAssignment = {
  id: string;
  agencyName: string;
  personnelName: string;
};
export type NewsOccurrence = {
  observedAt?: string;
  url: string;
  title: string;
  sourceName: string | null;
  publishedAt: string | null;
  summary: string | null;
  selector?: string;
  body?: string;
  paragraphs?: Array<{ hash: string; text: string }>;
  publisherAttribution?: string | null;
  domainRank?: number | null;
  uncertainty?: string;
  support?: Array<{ assignmentId: string; paragraphHashes: string[] }>;
};
export type ReleaseIdentity = Partial<SourceRef> & { canonicalId?: string };
export type ReleaseRelationship = ReleaseIdentity & {
  agencyPersonnelId: string;
  occurrenceUrl: string | null;
  confidence: string;
  notes: string | null;
  needsCorrection?: boolean;
};
export type ReleaseArticle = ReleaseIdentity & {
  preferredUrl: string;
  normalizedUrl: string;
  notes?: string | null;
  occurrences: Record<string, NewsOccurrence>;
  relationships: ReleaseRelationship[];
};
export type NewsInference = (
  body: string,
  candidates: readonly NewsAssignment[],
) => Promise<{
  summary: string;
  support: Array<{ assignmentId: string; paragraphIndexes: number[] }>;
}>;
export type NewsImportContext = {
  assignmentRef: (id: string) => Promise<string>;
  existingArticle: (
    ref: ReleaseIdentity,
  ) => Promise<ReleaseArticle | undefined>;
};
