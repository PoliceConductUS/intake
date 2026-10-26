import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { transform } from "../sources/gov.or.dpsst/transform.js";
import { buildArtifactsEnvelope } from "../src/cli/transform/source-transform.js";
const dirs: string[] = [];
afterEach(async () => {
  await Promise.all(dirs.map((d) => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
});
async function fixture() {
  const dir = await mkdtemp(join(tmpdir(), "oregon-transform-"));
  dirs.push(dir);
  const manifest = {
    version: 1,
    complete: true,
    prefixes: ["Smith"],
    searchFiles: ["search-Smith-1.html"],
    officers: [
      {
        id: "13177",
        employmentFiles: ["officer-13177-employment-1.html"],
        certificateFiles: ["officer-13177-certificates-1.html"],
      },
    ],
    agencies: [{ id: "ASH", file: "agency.html" }],
  };
  const search =
    '<table id="gvwEmployees"><tr><th>Name</th><th>ID</th><th>Agency Name</th><th>Rank/Position</th><th>Status</th></tr><tr><td><a href="EmployeeDetails.aspx?RecID=1&amp;RecNum=2&amp;AgcyID=ASH">Smith, Robert D. Jr.</a></td><td>13177</td><td><a href="AgencyList.aspx?Agcy=ASH">Ashland Police Department</a></td><td>Sergeant</td><td>Inactive</td></tr></table>';
  await writeFile(join(dir, "search-Smith-1.html"), search);
  for (const name of ["employment", "certificates", "agency"]) {
    let html = await readFile(
      new URL(`./fixtures/oregon-dpsst/${name}.html`, import.meta.url),
      "utf8",
    );
    if (name === "agency")
      html = html.replace(
        "Washington County Sheriff&#39;s Office",
        "Ashland Police Department",
      );
    await writeFile(
      join(
        dir,
        name === "agency" ? "agency.html" : `officer-13177-${name}-1.html`,
      ),
      html,
    );
  }
  await writeFile(join(dir, "manifest.json"), JSON.stringify(manifest));
  const logs: string[] = [];
  const run = (validationDate = new Date("2026-10-25T00:00:00Z")) =>
    transform({
      paths: [join(dir, "manifest.json")],
      validationDate,
      state: "or",
      readXlsx: async () => {
        throw Error("unused");
      },
      emit: async () => {},
      logger: { info: (m) => logs.push(m) },
    });
  return { dir, manifest, search, run, logs };
}
describe("Oregon transform", () => {
  it("emits canonical records, complete episodes, separate certificate levels, and dated statuses", async () => {
    const f = await fixture();
    const result = await f.run();
    expect(() =>
      buildArtifactsEnvelope("gov.or.dpsst", "sample", result),
    ).not.toThrow();
    const get = (kind: string) =>
      result.artifacts.find((a) => a.kind === kind)!.records;
    expect(Object.keys(get("AgencyPersonnel"))).toEqual([
      "13177|ASH|1979-06-02",
      "13177|ASH|1980-03-04",
      "13177|ASH|1980-06-03",
    ]);
    expect(get("Personnel")["13177"]).toMatchObject({
      spec: {
        first_name: "Robert",
        middle_name: "D.",
        last_name: "Smith",
        suffix: "Jr.",
      },
    });
    expect(get("Licenses")["13177|Police Officer Advanced"]).toMatchObject({
      spec: { first_awarded: "1986-07-31", status: "Expired" },
    });
    expect(Object.keys(get("AuthorityLicenses"))).toHaveLength(4);
    expect(Object.keys(get("LicenseActions"))).toHaveLength(4);
    expect(await f.run()).toEqual(result);
  });
  it("skips scheduled hires and their Required certificate rows only until the hire date", async () => {
    const f = await fixture();
    await writeFile(
      join(f.dir, "search-Smith-1.html"),
      f.search.replace("Inactive", "Active"),
    );
    const employmentPath = join(f.dir, "officer-13177-employment-1.html");
    const employment = await readFile(employmentPath, "utf8");
    const header = employment.slice(0, employment.indexOf('<tr class="row">'));
    await writeFile(
      employmentPath,
      header +
        "<tr><td>10/27/2026</td><td>Ashland Police Department</td><td>Hired</td><td>Police Off</td><td></td><td></td></tr></table>",
    );
    const certificatePath = join(f.dir, "officer-13177-certificates-1.html");
    const certificates = await readFile(certificatePath, "utf8");
    await writeFile(
      certificatePath,
      certificates
        .replaceAll("8/1/2026", "10/27/2026")
        .replaceAll("Expired", "Required")
        .replace(/(?:7\/31\/1986|8\/24\/1981|4\/12\/1982|6\/1\/2005)/g, ""),
    );
    const before = await f.run();
    for (const kind of ["AgencyPersonnel", "Licenses", "LicenseActions"])
      expect(
        before.artifacts.find((artifact) => artifact.kind === kind)!.records,
      ).toEqual({});
    expect(f.logs.join("\n")).toMatch(/skipped.*13177.*2026-10-27/);
    const onDate = await f.run(new Date("2026-10-27T00:00:00Z"));
    expect(
      Object.keys(
        onDate.artifacts.find(
          (artifact) => artifact.kind === "AgencyPersonnel",
        )!.records,
      ),
    ).toEqual(["13177|ASH|2026-10-27"]);
    expect(
      Object.keys(
        onDate.artifacts.find((artifact) => artifact.kind === "LicenseActions")!
          .records,
      ),
    ).toHaveLength(4);
  });
  it("retains unrelated future certificate dates for shared defect validation", async () => {
    const f = await fixture();
    const result = await f.run(new Date("2026-07-01T00:00:00Z"));
    const actions = result.artifacts.find(
      (artifact) => artifact.kind === "LicenseActions",
    )!.records;
    expect(Object.keys(actions)).toHaveLength(4);
    expect(
      actions["13177|Police Officer Advanced|Expired|2026-08-01"],
    ).toMatchObject({ spec: { action_date: "2026-08-01" } });
  });
  it("reports unavailable agency and omits every dangling assignment", async () => {
    const f = await fixture();
    await writeFile(
      join(f.dir, "agency.html"),
      await readFile(
        new URL("./fixtures/oregon-dpsst/agency-empty.html", import.meta.url),
        "utf8",
      ),
    );
    const r = await f.run();
    expect(
      r.artifacts.find((a) => a.kind === "AgencyPersonnel")!.records,
    ).toEqual({});
    expect(f.logs.join("\n")).toMatch(/ASH.*unavailable/);
    expect(f.logs.join("\n")).toMatch(/13177.*missing Agency/);
  });
  it("omits unavailable agency history before reconstructing service", async () => {
    const f = await fixture();
    const row = f.search.slice(f.search.indexOf("<tr><td>"), -8);
    await writeFile(
      join(f.dir, "search-Smith-1.html"),
      f.search.replace(
        "</table>",
        row
          .replaceAll("ASH", "O1Z")
          .replaceAll("Ashland Police Department", "Out of State Employment") +
          "</table>",
      ),
    );
    f.manifest.agencies.push({ id: "O1Z", file: "unidentified-agency.html" });
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    await writeFile(
      join(f.dir, "unidentified-agency.html"),
      await readFile(
        new URL("./fixtures/oregon-dpsst/agency-empty.html", import.meta.url),
        "utf8",
      ),
    );
    const path = join(f.dir, "officer-13177-employment-1.html");
    const original = await readFile(path, "utf8");
    const rows = [
      ["3/18/2017", "Resigned"],
      ["9/24/2016", "Resigned"],
      ["3/21/2016", "Hired"],
      ["9/15/2014", "Hired"],
    ]
      .map(
        ([date, action]) =>
          `<tr><td>${date}</td><td>Out of State Employment</td><td>${action}</td><td>Corr Offcr</td><td></td><td></td></tr>`,
      )
      .join("");
    const raw = original.replace("</table>", rows + "</table>");
    await writeFile(path, raw);
    const result = await f.run();
    expect(
      Object.keys(
        result.artifacts.find((a) => a.kind === "AgencyPersonnel")!.records,
      ),
    ).toEqual([
      "13177|ASH|1979-06-02",
      "13177|ASH|1980-03-04",
      "13177|ASH|1980-06-03",
    ]);
    expect(
      f.logs.filter(
        (m) => m.includes("13177") && m.includes("Out of State Employment"),
      ),
    ).toEqual([
      "dpsst: omitted AgencyPersonnel for Personnel 13177: Out of State Employment: missing Agency; 4 source rows retained",
    ]);
    expect(f.logs.join("\n")).not.toMatch(
      /matches .*open AgencyPersonnel|without hire|omitted unresolved/,
    );
    expect(await readFile(path, "utf8")).toBe(raw);
  });
  it("fails incomplete acquisitions and missing referenced officer details", async () => {
    const f = await fixture();
    await writeFile(
      join(f.dir, "manifest.json"),
      JSON.stringify({ ...f.manifest, complete: false }),
    );
    await expect(f.run()).rejects.toThrow();
    await writeFile(
      join(f.dir, "manifest.json"),
      JSON.stringify({ ...f.manifest, officers: [] }),
    );
    await expect(f.run()).rejects.toThrow(/13177/);
  });
  it("fails conflicting person identity", async () => {
    const f = await fixture();
    const row = f.search.slice(f.search.indexOf("<tr><td>"), -8);
    await writeFile(
      join(f.dir, "search-Smith-1.html"),
      f.search.replace(
        "</table>",
        row.replace("Robert D.", "Alice") + "</table>",
      ),
    );
    await expect(f.run()).rejects.toThrow(/conflict/i);
  });
  it("fails invalid dates in real parsed employment", async () => {
    const f = await fixture();
    const path = join(f.dir, "officer-13177-employment-1.html");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("8/1/2021", "2/30/2021"),
    );
    await expect(f.run()).rejects.toThrow(/Invalid DPSST date/);
  });
  it("rejects repeated page files", async () => {
    const f = await fixture();
    f.manifest.searchFiles.push("search-Smith-1.html");
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    await expect(f.run()).rejects.toThrow(/page|files/i);
  });
  it("rejects omitted continuation pages", async () => {
    const f = await fixture();
    await writeFile(
      join(f.dir, "search-Smith-1.html"),
      f.search +
        `<a href="javascript:__doPostBack('gvwEmployees','Page$2')">2</a>`,
    );
    await expect(f.run()).rejects.toThrow(/page/i);
  });
  it("rejects mismatched agency response", async () => {
    const f = await fixture();
    const p = join(f.dir, "agency.html");
    await writeFile(
      p,
      (await readFile(p, "utf8")).replace(
        "Ashland Police Department",
        "Wrong Agency",
      ),
    );
    await expect(f.run()).rejects.toThrow(/agency.*identity/i);
  });
  it("fails same certificate action identity with conflicting source award", async () => {
    const f = await fixture();
    const c = await readFile(
      join(f.dir, "officer-13177-certificates-1.html"),
      "utf8",
    );
    const row = c.match(/<tr class="row">[\s\S]*?<\/tr>/)![0];
    await writeFile(
      join(f.dir, "officer-13177-certificates-1.html"),
      c.replace("</table>", row.replace("7/31/1986", "7/30/1986") + "</table>"),
    );
    await expect(f.run()).rejects.toThrow(/Conflicting certificate/);
  });
  it("fails missing raw evidence files", async () => {
    const f = await fixture();
    await rm(join(f.dir, "agency.html"));
    await expect(f.run()).rejects.toThrow(/ENOENT/);
  });
});
