/**
 * Allocates slugs unique across the three resolution levels for an entity kind:
 * the current command (in-memory claims), intake-owned state, and the database.
 * A slug resolved without generation (a cached slug or a reused DB
 * slug) is registered so a later generated slug disambiguates from it; a
 * generated base gets a numeric suffix appended until free. The injected owner
 * lookup checks both the canonical property cache and database, and is memoized
 * once per candidate.
 */
export class SlugAllocator {
  private readonly claimsByKind = new Map<string, Map<string, string>>();
  private readonly durableOwnerByKind = new Map<
    string,
    Map<string, string | null>
  >();

  constructor(
    /** The id owning `slug` in canonical cache or database, or undefined if free. */
    private readonly lookupDurableOwner: (
      kind: string,
      slug: string,
    ) => Promise<string | undefined>,
  ) {}

  /** Register a resolved slug so a later generated slug disambiguates from it. */
  async register(
    kind: string,
    slug: string,
    canonicalId: string,
  ): Promise<void> {
    const owner = await this.durableOwnerId(kind, slug);
    if (owner !== undefined && owner !== canonicalId) {
      throw new Error(
        `Canonical slug conflict for ${kind} ${canonicalId}: ${slug} belongs to ${owner}.`,
      );
    }
    const claims = this.claimsFor(kind);
    const claimant = claims.get(slug);
    if (claimant !== undefined && claimant !== canonicalId) {
      throw new Error(
        `Canonical slug conflict for ${kind} ${canonicalId}: ${slug} is claimed by ${claimant}.`,
      );
    }
    claims.set(slug, canonicalId);
  }

  async ensureUnique(
    kind: string,
    input: { base: string; canonicalId: string },
  ): Promise<string> {
    const claims = this.claimsFor(kind);
    for (let attempt = 1; ; attempt += 1) {
      const candidate = attempt === 1 ? input.base : `${input.base}-${attempt}`;
      const owner = await this.durableOwnerId(kind, candidate);
      if (owner !== undefined && owner !== input.canonicalId) continue;
      // Check and assign the command claim synchronously after the durable
      // lookup. Concurrent continuations see prior claims, while a new candidate
      // can never temporarily claim an established entity's cached slug.
      const claimant = claims.get(candidate);
      if (claimant !== undefined && claimant !== input.canonicalId) continue;
      claims.set(candidate, input.canonicalId);
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

  private durableOwnerCacheFor(kind: string): Map<string, string | null> {
    let owners = this.durableOwnerByKind.get(kind);
    if (owners === undefined) {
      owners = new Map();
      this.durableOwnerByKind.set(kind, owners);
    }
    return owners;
  }

  private async durableOwnerId(
    kind: string,
    slug: string,
  ): Promise<string | undefined> {
    const owners = this.durableOwnerCacheFor(kind);
    const cached = owners.get(slug);
    if (cached !== undefined) {
      return cached ?? undefined;
    }
    const owner = await this.lookupDurableOwner(kind, slug);
    owners.set(slug, owner ?? null);
    return owner;
  }
}
