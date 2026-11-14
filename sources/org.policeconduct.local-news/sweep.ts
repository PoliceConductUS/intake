type Agency = { agencyId: string; name: string };
export type SweepPosition = {
  cursor?: string;
  nextCursor?: string;
  agency?: Agency;
  officers?: string[];
  queryIndex?: number;
  urls?: string[];
  nextPage?: string;
  index: number;
  complete?: boolean;
};
export async function sweepNews(
  previous: SweepPosition | undefined,
  deps: {
    agencies: (
      cursor?: string,
    ) => Promise<{ items: Agency[]; nextCursor?: string }>;
    officers: (agencyId: string) => Promise<string[]>;
    search: (
      query: string,
      nextPage?: string,
    ) => Promise<{ urls: string[]; nextPage?: string }>;
    visit: (url: string) => Promise<void>;
    save: (position: SweepPosition) => Promise<void>;
    shouldStop?: () => boolean;
  },
): Promise<void> {
  let position: SweepPosition = previous?.complete
    ? { index: 0 }
    : (previous ?? { index: 0 });
  while (!deps.shouldStop?.()) {
    if (!position.agency) {
      const page = await deps.agencies(position.cursor);
      const agency = page.items[0];
      if (!agency) {
        await deps.save({ index: 0, complete: true });
        return;
      }
      position = {
        cursor: position.cursor,
        nextCursor: page.nextCursor,
        agency,
        officers: await deps.officers(agency.agencyId),
        queryIndex: 0,
        index: 0,
      };
      await deps.save(position);
    }
    const agency = position.agency!;
    const officers =
      position.officers ?? (await deps.officers(agency.agencyId));
    const queryIndex = position.queryIndex ?? 0;
    const query =
      queryIndex === 0
        ? agency.name
        : officers[queryIndex - 1] + " " + agency.name;
    if (!position.urls) {
      const page = await deps.search(query, position.nextPage);
      if (page.nextPage && page.nextPage === position.nextPage)
        throw Error("Search provider repeated its next page.");
      position = {
        ...position,
        officers,
        queryIndex,
        urls: page.urls,
        nextPage: page.nextPage,
        index: 0,
      };
      await deps.save(position);
    }
    const urls = position.urls!;
    while (position.index < urls.length) {
      if (deps.shouldStop?.()) return;
      await deps.visit(urls[position.index]!);
      position = { ...position, index: position.index + 1 };
      await deps.save(position);
    }
    if (position.nextPage || queryIndex < officers.length) {
      position = {
        ...position,
        officers,
        queryIndex: position.nextPage ? queryIndex : queryIndex + 1,
        urls: undefined,
        index: 0,
      };
      await deps.save(position);
      continue;
    }
    if (!position.nextCursor) {
      await deps.save({ index: 0, complete: true });
      return;
    }
    position = { cursor: position.nextCursor, index: 0 };
    await deps.save(position);
  }
}
