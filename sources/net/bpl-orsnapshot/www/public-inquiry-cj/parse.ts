import { parse, type HTMLElement } from "node-html-parser";
export const BASE_URL = "https://www.bpl-orsnapshot.net/PublicInquiry_CJ/";
export type Affiliation = {
  officerId: string;
  name: string;
  agencyId: string;
  agencyName: string;
  rank: string;
  status: string;
  recordId: string;
  recordNumber: string;
  detailUrl: string;
};
export type Agency = {
  name: string;
  contactName: string | null;
  contactEmail: string | null;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string | null;
  status: string;
};
export type EmploymentEvent = {
  date: string;
  agencyName: string;
  action: string;
  rank: string;
  classification: string;
  assignment: string;
};
export type Certificate = {
  statusDate: string;
  certificate: string;
  level: string;
  status: string;
  certificateDate: string;
  expirationDate: string;
  probationDate: string;
};
const text = (e: HTMLElement) => e.textContent.replace(/\s+/g, " ").trim();
function tableRows(
  html: string,
  id: string,
  headers: string[],
  emptyMessage = "No Data Found",
): HTMLElement[][] {
  const table = parse(html).querySelector(`#${id}`);
  if (!table) throw Error(`Missing ${id} table`);
  const rows = table
    .querySelectorAll("tr")
    .filter((r) => r.closest("table") === table);
  if (
    rows.length === 1 &&
    text(rows[0]!) === emptyMessage &&
    rows[0]!.querySelector("td")?.getAttribute("colspan") ===
      String(headers.length)
  )
    return [];
  const actual = rows[0]?.querySelectorAll("th").map(text);
  if (JSON.stringify(actual) !== JSON.stringify(headers))
    throw Error(`Malformed ${id} headers`);
  if (
    rows.length === 2 &&
    text(rows[1]!) === emptyMessage &&
    rows[1]!.querySelector("td")?.getAttribute("colspan") ===
      String(headers.length)
  )
    return [];
  if (rows.length < 2) throw Error(`Missing ${id} data rows`);
  const dataRows = rows.slice(1).filter((r) => {
    if (!r.querySelector("table")) return true;
    if (
      !r.classList.contains("ListFooter") ||
      !r.querySelector("a") ||
      !r
        .querySelectorAll("a")
        .every((a) =>
          /__doPostBack\('[^']+','Page\$\d+'\)/.test(
            a.getAttribute("href") ?? "",
          ),
        )
    )
      throw Error(`Malformed ${id} pagination row`);
    return false;
  });
  if (!dataRows.length) throw Error(`Missing ${id} data rows`);
  return dataRows.map((r) => {
    const cells = r.querySelectorAll("td");
    if (cells.length !== headers.length) throw Error(`Malformed ${id} row`);
    return cells;
  });
}
export function sourceUrl(href: string, page: string): URL {
  const url = new URL(href, BASE_URL);
  if (
    url.origin !== new URL(BASE_URL).origin ||
    url.pathname !== new URL(page, BASE_URL).pathname
  )
    throw Error("Unexpected source URL");
  return url;
}
export function parseSearch(html: string): Affiliation[] {
  return tableRows(html, "gvwEmployees", [
    "Name",
    "ID",
    "Agency Name",
    "Rank/Position",
    "Status",
  ]).map((c) => {
    const link = c[0]!.querySelector("a")?.getAttribute("href");
    const agencyLink = c[2]!.querySelector("a")?.getAttribute("href");
    if (!link || !agencyLink) throw Error("Missing affiliation links");
    const url = sourceUrl(link, "EmployeeDetails.aspx");
    const agencyUrl = sourceUrl(agencyLink, "AgencyList.aspx");
    const officerId = text(c[1]!),
      recordId = url.searchParams.get("RecID")?.trim() ?? "",
      recordNumber = url.searchParams.get("RecNum")?.trim() ?? "",
      agencyId = url.searchParams.get("AgcyID")?.trim() ?? "";
    if (
      !/^\d+$/.test(officerId) ||
      !/^\d+$/.test(recordId) ||
      !/^\d+$/.test(recordNumber) ||
      !/^[A-Za-z0-9_]+$/.test(agencyId) ||
      agencyUrl.searchParams.get("Agcy")?.trim() !== agencyId
    )
      throw Error("Malformed affiliation identity");
    return {
      officerId,
      recordId,
      recordNumber,
      agencyId,
      name: text(c[0]!),
      agencyName: text(c[2]!),
      rank: text(c[3]!),
      status: text(c[4]!),
      detailUrl: url.href,
    };
  });
}
function verifyOfficer(html: string, id: string) {
  const header = parse(html).querySelector("td.header_level1");
  const actual = header && text(header).match(/\bID:\s*(\d+)\s*$/)?.[1];
  if (actual !== id)
    throw Error(
      `Officer identity mismatch: expected ${id}, received ${actual}`,
    );
}
export function parseEmployment(html: string, id: string): EmploymentEvent[] {
  verifyOfficer(html, id);
  return tableRows(html, "ContentPlaceHolder1_ctlEmploymentHistory_gvwGrid", [
    "Date",
    "Agency",
    "Action",
    "Rank",
    "Classification",
    "Assignment",
  ]).map((c) => ({
    date: text(c[0]!),
    agencyName: text(c[1]!),
    action: text(c[2]!),
    rank: text(c[3]!),
    classification: text(c[4]!),
    assignment: text(c[5]!),
  }));
}
export function parseCertificates(html: string, id: string): Certificate[] {
  verifyOfficer(html, id);
  return tableRows(
    html,
    "ContentPlaceHolder1_ctlEmployeeCertification_gvwGrid",
    [
      "Status Date",
      "Certificate",
      "Level",
      "Status",
      "Certificate Date",
      "Expiration Date",
      "Probation Date",
    ],
    "No certificate data!",
  ).map((c) => ({
    statusDate: text(c[0]!),
    certificate: text(c[1]!),
    level: text(c[2]!),
    status: text(c[3]!),
    certificateDate: text(c[4]!),
    expirationDate: text(c[5]!),
    probationDate: text(c[6]!),
  }));
}
export function parseAgency(html: string, expectedName: string): Agency | null {
  const rows = tableRows(html, "gvwAgencies", [
    "Name",
    "Primary Contact",
    "Address",
    "Phone",
    "County",
    "Status",
  ]);
  if (!rows.length) return null;
  const matches = rows.filter((row) => text(row[0]!) === expectedName);
  if (matches.length !== 1)
    throw Error(`Agency identity mismatch: expected one ${expectedName}`);
  const c = matches[0]!;
  const address1 = c[2]!.querySelector("[id*=lblAddress1_]"),
    address2 = c[2]!.querySelector("[id*=lblAddress2_]");
  if (!address1 || !address2) throw Error("Missing agency address fields");
  const locality = text(address2).match(
    /^(.*),\s*([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/,
  );
  const encoded = c[1]!
    .querySelector("[data-cfemail]")
    ?.getAttribute("data-cfemail");
  let email: string | null = null;
  if (encoded) {
    if (!/^(?:[a-f0-9]{2}){2,}$/i.test(encoded))
      throw Error("Malformed protected email");
    const key = parseInt(encoded.slice(0, 2), 16);
    email = Buffer.from(
      Buffer.from(encoded.slice(2), "hex").map((b) => b ^ key),
    )
      .toString("utf8")
      .trim();
  } else {
    const href = c[1]!.querySelector("a")?.getAttribute("href") ?? "";
    if (href.startsWith("mailto:")) email = href.slice(7).trim();
    else if (text(c[1]!.querySelector("a") ?? parse("")))
      throw Error("Unrecognized agency email");
  }
  return {
    name: text(c[0]!),
    contactName: c[1]!.querySelector("[id*=lblContact_]")
      ? text(c[1]!.querySelector("[id*=lblContact_]")!) || null
      : null,
    contactEmail: email,
    address: text(address1),
    city: locality?.[1] ?? "",
    state: locality?.[2] ?? "",
    zipCode: locality?.[3] ?? "",
    phone: text(c[3]!) || null,
    status: text(c[5]!),
  };
}
export function postbackFields(html: string): URLSearchParams {
  const body = new URLSearchParams();
  for (const e of parse(html).querySelectorAll("input[type=hidden]")) {
    const name = e.getAttribute("name");
    if (name) body.set(name, e.getAttribute("value") ?? "");
  }
  if (!body.has("__VIEWSTATE")) throw Error("Missing ASP.NET viewstate");
  return body;
}
export function nextPage(
  html: string,
  current: number,
): { target: string; argument: string; page: number } | null {
  const links = parse(html)
    .querySelectorAll("a")
    .flatMap((a) => {
      const href = a.getAttribute("href") ?? "";
      if (
        href.includes("Page$") &&
        !/__doPostBack\('[^']+','Page\$\d+'\)/.test(href)
      )
        throw Error("Unsupported pagination command");
      const m = a
        .getAttribute("href")
        ?.match(/__doPostBack\('([^']+)','Page\$(\d+)'\)/);
      return m
        ? [{ target: m[1]!, argument: `Page$${m[2]}`, page: Number(m[2]) }]
        : [];
    })
    .filter((p) => p.page > current)
    .sort((a, b) => a.page - b.page);
  const next = links[0];
  if (next && next.page !== current + 1) throw Error("Pagination gap");
  return next ?? null;
}
