import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { transform } from "../../../../../../sources/net/bpl-orsnapshot/www/public-inquiry-cj/transform.js";
import { buildArtifactsEnvelope } from "../../../../../../src/cli/transform/source-transform.js";
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
      new URL(
        `../../../../../fixtures/oregon-dpsst/${name}.html`,
        import.meta.url,
      ),
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
type Result = Awaited<ReturnType<typeof transform>>;
const source = "net/bpl-orsnapshot/www/public-inquiry-cj";
const officerUrl =
  "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/EmployeeDetails.aspx?RecID=1&RecNum=2&AgcyID=ASH";
const defects = (result: Result) =>
  result.artifacts.find((a) => a.kind === "LicensingAuthorities")!.records[
    "dpsst"
  ]!.metadata?.defects;
const accounting = (result: Result, input: string) =>
  result.accounting.find((entry) => entry.input === input);
const employmentRow = (
  date: string,
  action: string,
  rank: string,
  agency = "Ashland Police Department",
) =>
  `<tr><td>${date}</td><td>${agency}</td><td>${action}</td><td>${rank}</td><td></td><td></td></tr>`;
async function addEmployment(
  dir: string,
  rows: string[],
  place: "top" | "bottom" | "only",
) {
  const path = join(dir, "officer-13177-employment-1.html");
  const html = await readFile(path, "utf8");
  const first = html.indexOf('<tr class="row">');
  await writeFile(
    path,
    place === "bottom"
      ? html.replace("</table>", rows.join("") + "</table>")
      : html.slice(0, first) +
          rows.join("") +
          (place === "top" ? html.slice(first) : "</table>"),
  );
}
const employmentFinding = (
  row: number,
  fromOldest: number,
  code: string,
  value: Record<string, string>,
  message: string,
) => ({
  code,
  type: "warning",
  field: "agency_personnel",
  value: { classification: "", assignment: "", ...value },
  message,
  evidence: [{ url: officerUrl, file: "officer-13177-employment-1.html", row }],
  source_namespace: source,
  source_record_id: `officer-13177-employment#${fromOldest}`,
});
describe("Oregon transform", () => {
  it("accounts for every row and emits the licensing authority with no findings", async () => {
    const result = await (await fixture()).run();
    expect(result.accounting).toEqual([
      {
        input: "search pages",
        read: 1,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
      {
        input: "agency pages",
        read: 1,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
      {
        input: "employment pages",
        read: 7,
        emitted: 7,
        reported: 0,
        notSelected: {},
      },
      {
        input: "certificate pages",
        read: 4,
        emitted: 4,
        reported: 0,
        notSelected: {},
      },
    ]);
    expect(defects(result)).toEqual([]);
  });
  it("reports an agency whose listing gives no city, state or ZIP code", async () => {
    const f = await fixture();
    const path = join(f.dir, "agency.html");
    await writeFile(
      path,
      (await readFile(path, "utf8")).replace("Hillsboro, OR 97123", "PO Box 7"),
    );
    const result = await f.run();
    expect(defects(result)).toEqual([
      {
        code: "agency-not-buildable",
        type: "warning",
        field: "agencies",
        value: expect.objectContaining({
          name: "Ashland Police Department",
          address: "215 SW Adams Avenue, MS #32",
          city: "",
          state: "",
          zipCode: "",
        }),
        message:
          "Ashland Police Department (agency ASH) is in the department's agency list but is not listed here because its city, state, and ZIP code are missing or not usable. Employment at this agency is not listed either.",
        evidence: [
          {
            url: "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/AgencyList.aspx?Agcy=ASH",
            file: "agency.html",
          },
        ],
        source_namespace: source,
        source_record_id: "ASH",
      },
    ]);
    expect(accounting(result, "agency pages")).toMatchObject({
      read: 1,
      emitted: 0,
      reported: 1,
      notSelected: {},
    });
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 7,
      emitted: 0,
      reported: 7,
      notSelected: {},
    });
  });
  it("reports an employment row whose agency is in no search row", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow(
          "1/5/1975",
          "Hired",
          "Police Off",
          "Elsewhere Police Department",
        ),
      ],
      "bottom",
    );
    const result = await f.run();
    expect(defects(result)).toEqual([
      employmentFinding(
        8,
        1,
        "employment-agency-unknown",
        {
          date: "1/5/1975",
          agencyName: "Elsewhere Police Department",
          action: "Hired",
          rank: "Police Off",
        },
        "An employment record of officer 13177 at Elsewhere Police Department (Hired, 1/5/1975) is in the department's records but is not listed here because the agency could not be identified.",
      ),
    ]);
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 8,
      emitted: 7,
      reported: 1,
      notSelected: {},
    });
  });
  it("reports a separation with no start", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [employmentRow("1/1/1975", "Resigned", "Civln Emp")],
      "bottom",
    );
    const result = await f.run();
    expect(defects(result)).toEqual([
      employmentFinding(
        8,
        1,
        "employment-without-start",
        {
          date: "1/1/1975",
          agencyName: "Ashland Police Department",
          action: "Resigned",
          rank: "Civln Emp",
        },
        "An employment record of officer 13177 at Ashland Police Department (Resigned, 1/1/1975) is in the department's records but is not listed here because the records do not show when that employment started.",
      ),
    ]);
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 8,
      emitted: 7,
      reported: 1,
      notSelected: {},
    });
  });
  it("keeps each finding's source record ID when a newer event is added on top", async () => {
    const earlier = [
      employmentRow("5/1/1975", "Promotion", "Civln Emp"),
      employmentRow("1/1/1975", "Resigned", "Civln Emp"),
    ];
    const ids = (result: Result) =>
      defects(result)!.map((d) => [
        d.source_record_id,
        (d.value as { date: string }).date,
        d.evidence,
      ]);
    const before = await fixture();
    await addEmployment(before.dir, earlier, "bottom");
    expect(ids(await before.run())).toEqual([
      [
        "officer-13177-employment#2",
        "5/1/1975",
        [{ url: officerUrl, file: "officer-13177-employment-1.html", row: 8 }],
      ],
      [
        "officer-13177-employment#1",
        "1/1/1975",
        [{ url: officerUrl, file: "officer-13177-employment-1.html", row: 9 }],
      ],
    ]);
    const after = await fixture();
    await addEmployment(after.dir, earlier, "bottom");
    await addEmployment(
      after.dir,
      [employmentRow("9/1/2021", "Deceased", "Sergeant")],
      "top",
    );
    expect(ids(await after.run())).toEqual([
      [
        "officer-13177-employment#2",
        "5/1/1975",
        [{ url: officerUrl, file: "officer-13177-employment-1.html", row: 9 }],
      ],
      [
        "officer-13177-employment#1",
        "1/1/1975",
        [
          {
            url: officerUrl,
            file: "officer-13177-employment-1.html",
            row: 10,
          },
        ],
      ],
    ]);
  });
  it("keeps each finding's source record ID when a newer event moves a row to the next page", async () => {
    const f = await fixture();
    const page1 = join(f.dir, "officer-13177-employment-1.html");
    const html = await readFile(page1, "utf8");
    const rows = html.match(/<tr class="row(?:Alt)?">[\s\S]*?<\/tr>/g)!;
    const page = (rows: string[], next: boolean) =>
      html.slice(0, html.indexOf(rows0)) +
      rows.join("") +
      "</table>" +
      (next
        ? `<a href="javascript:__doPostBack('gvwGrid','Page$2')">2</a>`
        : "") +
      html.slice(html.indexOf("</table>") + "</table>".length);
    const rows0 = rows[0]!;
    const earlier = [
      employmentRow("5/1/1975", "Promotion", "Civln Emp"),
      employmentRow("1/1/1975", "Resigned", "Civln Emp"),
    ];
    f.manifest.officers[0]!.employmentFiles.push(
      "officer-13177-employment-2.html",
    );
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    const page2 = join(f.dir, "officer-13177-employment-2.html");
    const ids = async () =>
      defects(await f.run())!.map((d) => [
        d.source_record_id,
        d.evidence![0]!.file,
        d.evidence![0]!.row,
      ]);
    await writeFile(page1, page(rows, true));
    await writeFile(page2, page(earlier, false));
    expect(await ids()).toEqual([
      ["officer-13177-employment#2", "officer-13177-employment-2.html", 1],
      ["officer-13177-employment#1", "officer-13177-employment-2.html", 2],
    ]);
    await writeFile(
      page1,
      page(
        [
          employmentRow("9/1/2021", "Deceased", "Sergeant"),
          ...rows.slice(0, 6),
        ],
        true,
      ),
    );
    await writeFile(page2, page([rows[6]!, ...earlier], false));
    expect(await ids()).toEqual([
      ["officer-13177-employment#2", "officer-13177-employment-2.html", 2],
      ["officer-13177-employment#1", "officer-13177-employment-2.html", 3],
    ]);
  });
  it("ends an employment on the separation that follows a leave", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow("5/1/2022", "Resigned", "Police Off"),
        employmentRow("3/1/2022", "LOA", "Police Off"),
        employmentRow("1/1/2022", "Hired", "Police Off"),
      ],
      "top",
    );
    const result = await f.run();
    expect(defects(result)).toEqual([]);
    expect(
      result.artifacts.find((a) => a.kind === "AgencyPersonnel")!.records[
        "13177|ASH|2022-01-01"
      ],
    ).toEqual({
      spec: {
        agency_id: "ASH",
        personnel_id: "13177",
        start_date: "2022-01-01",
        end_date: "2022-05-01",
        title: "Police Off",
      },
    });
    expect(accounting(result, "employment pages")).toEqual({
      input: "employment pages",
      read: 10,
      emitted: 10,
      reported: 0,
      notSelected: {},
    });
  });
  it("counts a leave during a leave as not selected", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow("4/1/2022", "Mil-LOA", "Police Off"),
        employmentRow("3/1/2022", "LOA", "Police Off"),
        employmentRow("1/1/2022", "Hired", "Police Off"),
      ],
      "top",
    );
    const result = await f.run();
    expect(defects(result)).toEqual([]);
    expect(
      result.artifacts.find((a) => a.kind === "AgencyPersonnel")!.records[
        "13177|ASH|2022-01-01"
      ],
    ).toMatchObject({ spec: { end_date: "2022-03-01" } });
    expect(accounting(result, "employment pages")).toEqual({
      input: "employment pages",
      read: 10,
      emitted: 9,
      reported: 0,
      notSelected: { "leave while not in active service": 1 },
    });
  });
  it("fails an employment row with an action it does not know", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [employmentRow("9/1/2021", "Mystery", "Sergeant")],
      "top",
    );
    await expect(f.run()).rejects.toThrow(
      `${source}: officer-13177-employment-1.html row 1 has an unknown action "Mystery"`,
    );
  });
  it("reports once an employment with no end date for an officer who is not active, and counts its other rows", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow("2/1/2022", "Promotion", "Sergeant"),
        employmentRow("1/1/2022", "Hired", "Police Off"),
      ],
      "top",
    );
    const result = await f.run();
    expect(defects(result)).toEqual([
      employmentFinding(
        2,
        8,
        "employment-without-end",
        {
          date: "1/1/2022",
          agencyName: "Ashland Police Department",
          action: "Hired",
          rank: "Police Off",
        },
        "The employment of officer 13177 at Ashland Police Department that started on 1/1/2022 is in the department's records but is not listed here because the records give no end date for it and do not show the officer as active at the agency.",
      ),
    ]);
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 9,
      emitted: 7,
      reported: 2,
      notSelected: {},
    });
  });
  it("reports an employment with no rank or position", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow("2/1/2022", "Resigned", ""),
        employmentRow("1/1/2022", "Hired", ""),
      ],
      "top",
    );
    const result = await f.run();
    expect(defects(result)).toEqual([
      employmentFinding(
        2,
        8,
        "employment-without-position",
        {
          date: "1/1/2022",
          agencyName: "Ashland Police Department",
          action: "Hired",
          rank: "",
        },
        "The employment of officer 13177 at Ashland Police Department that started on 1/1/2022 is in the department's records but is not listed here because the records give no rank or position for it.",
      ),
    ]);
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 9,
      emitted: 7,
      reported: 2,
      notSelected: {},
    });
  });
  it("reports a change that fits no one position, the employments it leaves unclear, and counts the agency as not selected", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow("3/1/2020", "Promotion", "Captain"),
        employmentRow("2/1/2020", "Hired", "Deputy"),
        employmentRow("1/1/2020", "Hired", "Officer"),
      ],
      "only",
    );
    const result = await f.run();
    expect(
      defects(result)!.map((d) => [d.code, d.source_record_id, d.message]),
    ).toEqual([
      [
        "employment-position-ambiguous",
        "officer-13177-employment#3",
        "An employment record of officer 13177 at Ashland Police Department (Promotion, 3/1/2020) is in the department's records but is not listed here because it could not be matched to one of the officer's positions at the agency.",
      ],
      [
        "employment-unclear",
        "officer-13177-employment#2",
        "The employment of officer 13177 at Ashland Police Department that started on 2/1/2020 is in the department's records but is not listed here because another record could not be matched to it with certainty.",
      ],
      [
        "employment-unclear",
        "officer-13177-employment#1",
        "The employment of officer 13177 at Ashland Police Department that started on 1/1/2020 is in the department's records but is not listed here because another record could not be matched to it with certainty.",
      ],
    ]);
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 3,
      emitted: 0,
      reported: 3,
      notSelected: {},
    });
    expect(accounting(result, "agency pages")).toMatchObject({
      read: 1,
      emitted: 0,
      reported: 0,
      notSelected: { "no AgencyPersonnel": 1 },
    });
    expect(
      result.artifacts.find((a) => a.kind === "Agencies")!.records,
    ).toEqual({});
  });
  it("fails an employment row at an agency name that two agency codes share", async () => {
    const f = await fixture();
    const row = f.search.slice(f.search.indexOf("<tr><td>"), -8);
    await writeFile(
      join(f.dir, "search-Smith-1.html"),
      f.search.replace(
        "</table>",
        row.replaceAll("ASH", "ASH2").replace("RecID=1", "RecID=3") +
          "</table>",
      ),
    );
    f.manifest.agencies.push({ id: "ASH2", file: "agency2.html" });
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    await writeFile(
      join(f.dir, "agency2.html"),
      await readFile(join(f.dir, "agency.html"), "utf8"),
    );
    await expect(f.run()).rejects.toThrow(
      `${source}: officer-13177-employment-1.html row 1 names agency "Ashland Police Department", which has more than one agency code`,
    );
  });
  it("counts rows its selection rule leaves out, with no finding", async () => {
    const f = await fixture();
    await addEmployment(
      f.dir,
      [
        employmentRow("9/1/2021", "Deceased", "Sergeant"),
        employmentRow("8/15/2021", "InstrApp", ""),
        employmentRow("8/1/2021", "Retired", "Sergeant"),
      ],
      "top",
    );
    const certificates = join(f.dir, "officer-13177-certificates-1.html");
    const c = await readFile(certificates, "utf8");
    await writeFile(
      certificates,
      c.replace(
        "</table>",
        c.match(/<tr class="row">[\s\S]*?<\/tr>/)![0] + "</table>",
      ),
    );
    f.manifest.prefixes.push("Smi");
    f.manifest.searchFiles.push("search-Smi-1.html");
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    await writeFile(join(f.dir, "search-Smi-1.html"), f.search);
    const result = await f.run();
    expect(defects(result)).toEqual([]);
    expect(result.accounting).toEqual([
      {
        input: "search pages",
        read: 2,
        emitted: 1,
        reported: 0,
        notSelected: { "repeated row": 1 },
      },
      {
        input: "agency pages",
        read: 1,
        emitted: 1,
        reported: 0,
        notSelected: {},
      },
      {
        input: "employment pages",
        read: 10,
        emitted: 7,
        reported: 0,
        notSelected: {
          "repeated row": 1,
          "certification action": 1,
          "separation after separation": 1,
        },
      },
      {
        input: "certificate pages",
        read: 5,
        emitted: 4,
        reported: 0,
        notSelected: { "repeated row": 1 },
      },
    ]);
  });
  it.each([
    ["Police Officer", "certificate type"],
    ["Expired", "status"],
    ["8/1/2026", "status date"],
  ])("fails a certificate row with a blank %s cell", async (cell, name) => {
    const f = await fixture();
    const path = join(f.dir, "officer-13177-certificates-1.html");
    const c = await readFile(path, "utf8");
    const row = c.match(/<tr class="row">[\s\S]*?<\/tr>/)![0];
    await writeFile(path, c.replace(row, row.replace(cell, "")));
    await expect(f.run()).rejects.toThrow(
      `${source}: officer-13177-certificates-1.html row 1 has a blank ${name}`,
    );
  });
  it.each(["Emergency Medical Dispatcher", "EMD Maintenance", "Instructor"])(
    "retains personnel, employment and actual %s credentials",
    async (certificate) => {
      const f = await fixture();
      const file = join(f.dir, "officer-13177-certificates-1.html");
      await writeFile(
        file,
        (await readFile(file, "utf8")).replaceAll(
          "Police Officer",
          certificate,
        ),
      );
      const result = await f.run();
      const get = (kind: string) =>
        result.artifacts.find((a) => a.kind === kind)!.records;
      expect(get("Personnel")["13177"]).toMatchObject({
        spec: { first_name: "Robert", last_name: "Smith" },
      });
      expect(get("Agencies")["ASH"]).toMatchObject({
        spec: { name: "Ashland Police Department" },
      });
      expect(Object.keys(get("AgencyPersonnel"))).toEqual([
        "13177|ASH|1979-06-02",
        "13177|ASH|1980-03-04",
        "13177|ASH|1980-06-03",
      ]);
      expect(get("AgencyPersonnel")["13177|ASH|1980-06-03"]).toMatchObject({
        spec: {
          personnel_id: "13177",
          agency_id: "ASH",
          start_date: "1980-06-03",
          end_date: "2021-08-01",
          title: "Sergeant",
        },
      });
      expect(Object.keys(get("Licenses"))).toEqual([
        `13177|${certificate} Advanced`,
        `13177|${certificate} Basic`,
        `13177|${certificate} Intermediate`,
        `13177|${certificate} Supervisory`,
      ]);
      expect(get("Licenses")[`13177|${certificate} Advanced`]).toEqual({
        spec: {
          personnel_id: "13177",
          authority_license_id: `dpsst|${certificate} Advanced`,
          first_awarded: "1986-07-31",
          status: "Expired",
        },
      });
      expect(get("AuthorityLicenses")[`dpsst|${certificate} Advanced`]).toEqual(
        {
          spec: {
            licensing_authority_id: "dpsst",
            name: `${certificate} Advanced`,
          },
        },
      );
      expect(
        get("LicenseActions")[
          `13177|${certificate} Advanced|Expired|2026-08-01`
        ],
      ).toEqual({
        spec: {
          license_id: `13177|${certificate} Advanced`,
          action: "Expired",
          action_date: "2026-08-01",
          status: "Expired",
        },
      });
      expect(result.artifacts.some((a) => a.kind === "DataAnnotations")).toBe(
        false,
      );
    },
  );
  it("retains personnel and employment without inventing licenses for empty certificates", async () => {
    const f = await fixture();
    await writeFile(
      join(f.dir, "officer-13177-certificates-1.html"),
      (
        await readFile(
          new URL(
            "../../../../../fixtures/oregon-dpsst/certificates-empty.html",
            import.meta.url,
          ),
          "utf8",
        )
      ).replaceAll("65863", "13177"),
    );
    const result = await f.run();
    const get = (kind: string) =>
      result.artifacts.find((a) => a.kind === kind)!.records;
    expect(get("Personnel")["13177"]).toMatchObject({
      spec: { first_name: "Robert", last_name: "Smith" },
    });
    expect(get("Agencies")["ASH"]).toMatchObject({
      spec: { name: "Ashland Police Department" },
    });
    expect(Object.keys(get("AgencyPersonnel"))).toEqual([
      "13177|ASH|1979-06-02",
      "13177|ASH|1980-03-04",
      "13177|ASH|1980-06-03",
    ]);
    expect(get("AgencyPersonnel")["13177|ASH|1980-06-03"]).toMatchObject({
      spec: {
        personnel_id: "13177",
        agency_id: "ASH",
        start_date: "1980-06-03",
        end_date: "2021-08-01",
        title: "Sergeant",
      },
    });
    for (const kind of ["Licenses", "AuthorityLicenses", "LicenseActions"])
      expect(get(kind)).toEqual({});
  });
  it.each([
    "Police Officer",
    "Retired Police Officer",
    "Corrections Officer",
    "Parole & Probation Officer",
    "Regulatory Specialist",
    "Telecommunicator",
    "Telecommunicator Maintenance",
  ])(
    "retains %s regardless of status, with their other credentials",
    async (certificate) => {
      const f = await fixture();
      const file = join(f.dir, "officer-13177-certificates-1.html");
      await writeFile(
        file,
        (await readFile(file, "utf8"))
          .replaceAll("Police Officer", certificate)
          .replace(certificate, "Emergency Medical Dispatcher")
          .replaceAll("Expired", "Revoked"),
      );
      const result = await f.run();
      expect(
        Object.keys(
          result.artifacts.find((a) => a.kind === "Personnel")!.records,
        ),
      ).toEqual(["13177"]);
      expect(
        Object.keys(
          result.artifacts.find((a) => a.kind === "Agencies")!.records,
        ),
      ).toEqual(["ASH"]);
      expect(
        Object.keys(
          result.artifacts.find((a) => a.kind === "Licenses")!.records,
        ),
      ).toContain("13177|Emergency Medical Dispatcher Advanced");
    },
  );
  it("keeps both people's relationships and credentials at a shared agency", async () => {
    const f = await fixture();
    const row = f.search.slice(
      f.search.indexOf("<tr><td>"),
      f.search.indexOf("</table>"),
    );
    await writeFile(
      join(f.dir, "search-Smith-1.html"),
      f.search.replace(
        "</table>",
        row
          .replaceAll("13177", "13178")
          .replaceAll("RecID=1", "RecID=3")
          .replaceAll("Robert", "Robin") + "</table>",
      ),
    );
    f.manifest.officers.push({
      id: "13178",
      employmentFiles: ["officer-13178-employment-1.html"],
      certificateFiles: ["officer-13178-certificates-1.html"],
    });
    for (const kind of ["employment", "certificates"]) {
      const html = (
        await readFile(join(f.dir, `officer-13177-${kind}-1.html`), "utf8")
      ).replaceAll("13177", "13178");
      await writeFile(
        join(f.dir, `officer-13178-${kind}-1.html`),
        kind === "certificates"
          ? html.replaceAll("Police Officer", "Emergency Medical Dispatcher")
          : html,
      );
    }
    await writeFile(join(f.dir, "manifest.json"), JSON.stringify(f.manifest));
    const result = await f.run();
    const get = (kind: string) =>
      result.artifacts.find((a) => a.kind === kind)!.records;
    expect(Object.keys(get("Personnel"))).toEqual(["13177", "13178"]);
    expect(Object.keys(get("Agencies"))).toEqual(["ASH"]);
    expect(Object.keys(get("AgencyPhoneNumbers"))).toHaveLength(1);
    for (const kind of ["AgencyPersonnel", "Licenses", "LicenseActions"]) {
      for (const id of ["13177", "13178"])
        expect(
          Object.keys(get(kind)).some((key) => key.startsWith(`${id}|`)),
        ).toBe(true);
    }
  });
  it("emits canonical records, complete episodes, separate certificate levels, and dated statuses", async () => {
    const f = await fixture();
    const result = await f.run();
    expect(() =>
      buildArtifactsEnvelope(
        "net/bpl-orsnapshot/www/public-inquiry-cj",
        "sample",
        result,
      ),
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
  it("retains scheduled hires and their Required certificate rows before the hire date", async () => {
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
    const onDate = await f.run(new Date("2026-10-27T00:00:00Z"));
    expect(before.artifacts).toEqual(onDate.artifacts);
    expect(f.logs.join("\n")).not.toMatch(/skipped scheduled/);
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
  it("reports an agency with no entry in the agency list and counts its employment rows", async () => {
    const f = await fixture();
    await writeFile(
      join(f.dir, "agency.html"),
      await readFile(
        new URL(
          "../../../../../fixtures/oregon-dpsst/agency-empty.html",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const r = await f.run();
    expect(
      r.artifacts.find((a) => a.kind === "AgencyPersonnel")!.records,
    ).toEqual({});
    expect(defects(r)).toEqual([
      {
        code: "agency-not-in-agency-list",
        type: "warning",
        field: "agencies",
        value: null,
        message:
          "Ashland Police Department (agency ASH) is named in the department's officer records, but the department's agency list has no entry for it, so it is not listed here. Employment at this agency is not listed either.",
        evidence: [
          {
            url: "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/AgencyList.aspx?Agcy=ASH",
            file: "agency.html",
          },
        ],
        source_namespace: source,
        source_record_id: "ASH",
      },
    ]);
    expect(
      Object.keys(r.artifacts.find((a) => a.kind === "Personnel")!.records),
    ).toEqual(["13177"]);
    expect(accounting(r, "agency pages")).toMatchObject({
      read: 1,
      emitted: 0,
      reported: 1,
      notSelected: {},
    });
    expect(accounting(r, "employment pages")).toMatchObject({
      read: 7,
      emitted: 0,
      reported: 7,
      notSelected: {},
    });
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
        new URL(
          "../../../../../fixtures/oregon-dpsst/agency-empty.html",
          import.meta.url,
        ),
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
    expect(defects(result)!.map((d) => [d.code, d.source_record_id])).toEqual([
      ["agency-not-in-agency-list", "O1Z"],
    ]);
    expect(accounting(result, "employment pages")).toMatchObject({
      read: 11,
      emitted: 7,
      reported: 4,
      notSelected: {},
    });
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
