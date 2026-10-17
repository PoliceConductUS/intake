import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { it, expect } from "vitest";
import {
  collectDisciplinePersonnel,
  requireExactLicense,
} from "../../../../sources/mn-post/acquire/collect-discipline.js";
import { artifactStem } from "../../../../sources/mn-post/acquire/collect.js";
it("rejects wrong license, ambiguous results, and absent stable identities", () => {
  for (const rows of [
    [{ licenseNumber: "2", contactId: "c", licenseId: "l" }],
    [{ licenseNumber: "1", contactId: "c" }],
    [
      { licenseNumber: "1", contactId: "c", licenseId: "l" },
      { licenseNumber: "1", contactId: "d", licenseId: "m" },
    ],
  ])
    expect(() => requireExactLicense("1", rows)).toThrow();
});
it("collects a revoked officer outside rosters, refreshes stale details, and resumes completed requests", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "mn-disc-"));
  try {
    await mkdir(path.join(sourceDir, "officers"));
    const detailPath = path.join(
      sourceDir,
      "officers",
      `${artifactStem("l")}.detail.json`,
    );
    await writeFile(detailPath, JSON.stringify({ disciplinaryActions: [] }));
    let requests = 0;
    const person = {
      licenseNumber: "1",
      name: "Same Name",
      sourceRow: 2,
      history: [],
    };
    const officer = {
      licenseNumber: "1",
      name: "Name, Same",
      contactId: "c",
      licenseId: "l",
      status: "Revoked",
    };
    const detail = { disciplinaryActions: [{ caseNumber: "real-order" }] };
    const deps = {
      sourceDir,
      people: [person],
      cache: {
        resolve: async () => ({ kind: "resolved" as const, agencyId: "a" }),
        entries: () => ({}),
      },
      client: {
        searchLicense: async () => [officer],
        fetchOfficerDetails: async () => {
          requests++;
          return [detail];
        },
      },
    };
    await collectDisciplinePersonnel(deps);
    expect(JSON.parse(await readFile(detailPath, "utf8"))).toEqual(detail);
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-personnel.json"),
          "utf8",
        ),
      ),
    ).toEqual({ people: [{ ...person, officer }], missingActions: [] });
    await collectDisciplinePersonnel({
      ...deps,
      client: {
        searchLicense: async () => {
          throw new Error("must resume");
        },
        fetchOfficerDetails: deps.client.fetchOfficerDetails,
      },
    });
    expect(requests).toBe(1);
  } finally {
    await rm(sourceDir, { recursive: true });
  }
});
it("reports absent actual actions without creating discipline", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "mn-disc-"));
  try {
    await collectDisciplinePersonnel({
      sourceDir,
      people: [{ licenseNumber: "1", name: "A", sourceRow: 2, history: [] }],
      cache: {
        resolve: async () => ({ kind: "resolved", agencyId: "a" }),
        entries: () => ({}),
      },
      client: {
        searchLicense: async () => [
          { licenseNumber: "1", contactId: "c", licenseId: "l" },
        ],
        fetchOfficerDetails: async () => [
          { disciplinaryActions: "No POST Disciplinary Actions found" },
        ],
      },
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-personnel.json"),
          "utf8",
        ),
      ).missingActions,
    ).toEqual([{ licenseNumber: "1", contactId: "c" }]);
  } finally {
    await rm(sourceDir, { recursive: true });
  }
});

it("preserves unresolved searches and explicitly reports partial coverage while allowing confirmed licenses", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "mn-disc-"));
  try {
    const responses = [
      [],
      [{ licenseNumber: "999", contactId: "wrong", licenseId: "wrong" }],
      [
        { licenseNumber: "3", contactId: "c3", licenseId: "l3" },
        { licenseNumber: "3", contactId: "other", licenseId: "other" },
      ],
      [{ licenseNumber: "4", contactId: "c4", licenseId: "l4" }],
    ];
    const deps = {
      sourceDir,
      people: ["1", "2", "3", "4"].map((licenseNumber, index) => ({
        licenseNumber,
        name: "Person",
        sourceRow: index + 2,
        history: [],
      })),
      cache: {
        resolve: async () => ({ kind: "resolved" as const, agencyId: "a" }),
        entries: () => ({}),
      },
      client: {
        searchLicense: async (number: string) => responses[Number(number) - 1],
        fetchOfficerDetails: async () => [{ disciplinaryActions: [] }],
      },
    };
    const messages: string[] = [];
    await collectDisciplinePersonnel({
      ...deps,
      logger: { info: (message) => messages.push(message) },
    });
    expect(
      messages.some((message) =>
        message.includes("4 input licenses; 1 resolved; 3 unresolved"),
      ),
    ).toBe(true);
    for (let i = 0; i < responses.length; i++)
      expect(
        JSON.parse(
          await readFile(
            path.join(sourceDir, "discipline-requests", `${i + 1}.search.json`),
            "utf8",
          ),
        ),
      ).toEqual(responses[i]);
    const inventory = JSON.parse(
      await readFile(path.join(sourceDir, "discipline-personnel.json"), "utf8"),
    );
    expect(
      inventory.people.map(
        (person: { licenseNumber: string }) => person.licenseNumber,
      ),
    ).toEqual(["4"]);
    expect(inventory.missingActions).toEqual([
      { licenseNumber: "4", contactId: "c4" },
    ]);
    const unresolved = JSON.parse(
      await readFile(
        path.join(sourceDir, "discipline-unresolved-licenses.json"),
        "utf8",
      ),
    );
    expect(
      unresolved.map((person: { licenseNumber: string; sourceRow: number }) => [
        person.licenseNumber,
        person.sourceRow,
      ]),
    ).toEqual([
      ["1", 2],
      ["2", 3],
      ["3", 4],
    ]);
    await collectDisciplinePersonnel({
      ...deps,
      client: {
        searchLicense: async () => {
          throw new Error("already saved");
        },
        fetchOfficerDetails: async () => {
          throw new Error("already completed");
        },
      },
    });
  } finally {
    await rm(sourceDir, { recursive: true });
  }
});

it("resolves a missing part time license through exact licenses in another detail without name matching", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "mn-disc-"));
  try {
    const full = {
      licenseNumber: "15680",
      contactId: "c",
      licenseId: "full",
      name: "Same Person",
    };
    const part = {
      licenseNumber: "84038",
      contactId: "c",
      licenseId: "part",
      name: "Same Person",
    };
    const requested: string[] = [];
    const deps = {
      sourceDir,
      people: [
        {
          licenseNumber: "84038",
          name: "Spreadsheet name differs",
          sourceRow: 2,
          history: [],
        },
        {
          licenseNumber: "15680",
          name: "Same Person",
          sourceRow: 3,
          history: [],
        },
      ],
      cache: {
        resolve: async () => ({ kind: "resolved" as const, agencyId: "a" }),
        entries: () => ({}),
      },
      client: {
        searchLicense: async (number: string) =>
          number === "84038" ? [] : [full],
        fetchOfficerDetails: async (rows: (typeof full)[]) => {
          requested.push(rows[0].licenseId);
          return [
            {
              disciplinaryActions: [],
              licenses: { POSTLicenseList: [full, part] },
            },
          ];
        },
      },
    };
    await collectDisciplinePersonnel(deps);
    expect(requested).toEqual(["full", "part"]);
    const inventory = JSON.parse(
      await readFile(path.join(sourceDir, "discipline-personnel.json"), "utf8"),
    );
    expect(
      inventory.people.find(
        (p: { licenseNumber: string }) => p.licenseNumber === "84038",
      ).officer,
    ).toEqual(part);
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-requests", "84038.search.json"),
          "utf8",
        ),
      ),
    ).toEqual([]);
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-requests", "84038.resolution.json"),
          "utf8",
        ),
      ),
    ).toMatchObject({
      officer: part,
      sourceDetail: `officers/${artifactStem("full")}.detail.json`,
    });
    await collectDisciplinePersonnel({
      ...deps,
      client: {
        searchLicense: async () => {
          throw new Error("saved");
        },
        fetchOfficerDetails: async () => {
          throw new Error("completed");
        },
      },
    });
  } finally {
    await rm(sourceDir, { recursive: true });
  }
});

it("resolves zero search from an existing roster detail and refreshes that exact license", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "mn-disc-"));
  try {
    const officer = {
      licenseNumber: "12527",
      contactId: "c",
      licenseId: "existing",
      name: "Person",
    };
    await mkdir(path.join(sourceDir, "officers"));
    const detailFile = path.join(
      "officers",
      `${artifactStem("existing")}.detail.json`,
    );
    await writeFile(
      path.join(sourceDir, detailFile),
      JSON.stringify({
        disciplinaryActions: [],
        licenses: { POSTLicenseList: [officer] },
      }),
    );
    let refreshed = false;
    await collectDisciplinePersonnel({
      sourceDir,
      people: [
        { licenseNumber: "12527", name: "Person", sourceRow: 88, history: [] },
      ],
      cache: {
        resolve: async () => ({ kind: "resolved", agencyId: "a" }),
        entries: () => ({}),
      },
      client: {
        searchLicense: async () => [],
        fetchOfficerDetails: async (rows) => {
          expect(rows).toEqual([officer]);
          refreshed = true;
          return [
            {
              disciplinaryActions: [{ caseNumber: "new action" }],
              licenses: { POSTLicenseList: [] },
            },
          ];
        },
      },
    });
    await collectDisciplinePersonnel({
      sourceDir,
      people: [
        { licenseNumber: "12527", name: "Person", sourceRow: 88, history: [] },
      ],
      cache: {
        resolve: async () => ({ kind: "resolved", agencyId: "a" }),
        entries: () => ({}),
      },
      client: {
        searchLicense: async () => {
          throw new Error("saved search");
        },
        fetchOfficerDetails: async () => {
          throw new Error("completed detail");
        },
      },
    });
    expect(refreshed).toBe(true);
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-requests", "12527.resolution.json"),
          "utf8",
        ),
      ),
    ).toEqual({ officer, sourceDetail: detailFile });
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-personnel.json"),
          "utf8",
        ),
      ).people[0].officer,
    ).toEqual(officer);
  } finally {
    await rm(sourceDir, { recursive: true });
  }
});

it("retains independently resolved personnel while reporting unresolved history agencies", async () => {
  const sourceDir = await mkdtemp(path.join(tmpdir(), "mn-disc-"));
  try {
    const person = {
      licenseNumber: "123",
      name: "Person",
      sourceRow: 2,
      history: [
        {
          sourceRow: 7,
          agencyName: "Former Agency",
          startDate: "2000-01-01",
          endDate: "2001-01-01",
        },
      ],
    };
    const officer = { licenseNumber: "123", contactId: "c", licenseId: "l" };
    const messages: string[] = [];
    await collectDisciplinePersonnel({
      sourceDir,
      people: [person],
      client: {
        searchLicense: async () => [officer],
        fetchOfficerDetails: async () => [{ disciplinaryActions: [] }],
      },
      cache: {
        resolve: async () => ({
          kind: "skip",
          reason: "No exact agency",
          candidateCount: 0,
        }),
        entries: () => ({}),
      },
      logger: { info: (message) => messages.push(message) },
    });
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-personnel.json"),
          "utf8",
        ),
      ).people,
    ).toEqual([{ ...person, officer }]);
    expect(
      JSON.parse(
        await readFile(
          path.join(sourceDir, "discipline-unresolved-agencies.json"),
          "utf8",
        ),
      ),
    ).toEqual([
      {
        agencyName: "Former Agency",
        kind: "skip",
        reason: "No exact agency",
        candidateCount: 0,
      },
    ]);
    expect(
      messages.some((message) =>
        message.includes("1 unresolved history agencies"),
      ),
    ).toBe(true);
  } finally {
    await rm(sourceDir, { recursive: true });
  }
});
