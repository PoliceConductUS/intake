export type SourceRef = { namespace: string; sourceId: string };
export type NewsAssignment = {
  id: string;
  agencyName: string;
  personnelName: string;
  personnelNames?: string[];
};
export type NewsOccurrence = Partial<SourceRef> & {
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
  paragraphs?: readonly string[],
) => Promise<{
  summary: string;
  support: Array<{ assignmentId: string; paragraphIndexes: number[] }>;
}>;
