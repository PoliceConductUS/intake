/**
 * Allocates slugs unique across the three resolution levels for an entity kind:
 * the current command (in-memory claims), intake-owned state, and the database.
 * A slug resolved without generation (an explicit source slug or a reused DB
 * slug) is registered so a later generated slug disambiguates from it; a
 * generated base gets a numeric suffix appended until free. Because a
 * durably-resolved slug is persisted on import, the database is the durable
 * authority for the state level — read once per candidate and memoized.
 */
export class SlugAllocator {
  private readonly claimsByKind = new Map<string, Map<string, string>>();
  private readonly databaseOwnerByKind = new Map<
    string,
    Map<string, string | null>
  >();

  constructor(
    /** The id owning `slug` for `kind` in the database, or undefined if free. */
    private readonly lookupDatabaseOwner: (
      kind: string,
      slug: string,
    ) => Promise<string | undefined>,
  ) {}

  /** Register a resolved slug so a later generated slug disambiguates from it. */
  register(kind: string, slug: string, canonicalId: string): void {
    this.claimsFor(kind).set(slug, canonicalId);
  }

  async ensureUnique(
    kind: string,
    input: { base: string; canonicalId: string },
  ): Promise<string> {
    const claims = this.claimsFor(kind);
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? input.base : `${input.base}-${attempt}`;
      const claimant = claims.get(candidate);
      if (claimant !== undefined) {
        if (claimant === input.canonicalId) {
          return candidate;
        }
        continue;
      }
      // Claim synchronously BEFORE the async database check, so another entity
      // resolving the same base concurrently (facades resolve via Promise.all)
      // sees the claim and moves to the next candidate — closing the
      // check-then-claim race that would otherwise hand two rows one slug.
      claims.set(candidate, input.canonicalId);
      const databaseOwner = await this.databaseOwnerId(kind, candidate);
      if (databaseOwner !== undefined && databaseOwner !== input.canonicalId) {
        // The database already owns this slug for a different entity; release
        // the optimistic claim and try the next candidate.
        if (claims.get(candidate) === input.canonicalId) {
          claims.delete(candidate);
        }
        continue;
      }
      return candidate;
    }
  }

  private claimsFor(kind: string): Map<string, string> {
    let claims = this.claimsByKind.get(kind);
    if (claims === undefined) {
      claims = new Map();
      this.claimsByKind.set(kind, claims);
    }
    return claims;
  }

  private databaseOwnerCacheFor(kind: string): Map<string, string | null> {
    let owners = this.databaseOwnerByKind.get(kind);
    if (owners === undefined) {
      owners = new Map();
      this.databaseOwnerByKind.set(kind, owners);
    }
    return owners;
  }

  private async databaseOwnerId(
    kind: string,
    slug: string,
  ): Promise<string | undefined> {
    const owners = this.databaseOwnerCacheFor(kind);
    const cached = owners.get(slug);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const owner = await this.lookupDatabaseOwner(kind, slug);
    owners.set(slug, owner ?? null);
    return owner;
  }
}
