// The human-readable read shape of an annotation, written by intake when it
// writes the annotation (supply-site-display-data, design.md D11 and
// "Annotation read shape"): the page the annotation shows on (one attachment
// column) and the ordered links to the records it connects, each a site path
// built from the records' stored canonical paths and slugs, with a label.

type Row = Record<string, unknown>;

/** Reads one row of a kind by its primary key; fails when it is missing. */
export type AnnotationRowReader = (kind: string, id: string) => Promise<Row>;

export const ANNOTATION_ATTACHMENT_COLUMNS = [
  "personnel_id",
  "agency_id",
  "review_id",
  "civil_case_id",
  "location_path_id",
  "federal_agency_id",
  "licensing_authority_id",
] as const;

export type AnnotationAttachmentColumn =
  (typeof ANNOTATION_ATTACHMENT_COLUMNS)[number];

export type AnnotationLink = { url: string | null; label: string };

export type AnnotationPage = {
  attachment: Record<AnnotationAttachmentColumn, string | null>;
  links: AnnotationLink[];
};

type Target = {
  column: AnnotationAttachmentColumn;
  id: string;
  link: AnnotationLink;
};

// The page an annotation attaches to (owner, 2026-11-22): a linked person,
// else a linked agency, else the record whose page shows it, else the
// licensing authority only.
const ATTACHMENT_PRIORITY: readonly AnnotationAttachmentColumn[] = [
  "personnel_id",
  "agency_id",
  "review_id",
  "civil_case_id",
  "location_path_id",
  "federal_agency_id",
  "licensing_authority_id",
];

function text(row: Row, column: string, kind: string): string {
  const value = row[column];
  if (typeof value !== "string" || value.trim() === "")
    throw new Error(`Annotation link: ${kind} requires ${column}.`);
  return value;
}

function optionalText(row: Row, column: string): string | undefined {
  const value = row[column];
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function utcDate(value: unknown): string | undefined {
  if (value === null || value === undefined) return undefined;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime()))
    throw new Error(`Annotation link: invalid report incident_date ${value}.`);
  return date.toISOString().slice(0, 10);
}

async function personTarget(
  read: AnnotationRowReader,
  personnelId: string,
  fragment?: string,
): Promise<Target> {
  const person = await read("Personnel", personnelId);
  const label = ["prefix", "first_name", "middle_name", "last_name", "suffix"]
    .map((column) => optionalText(person, column))
    .filter((part): part is string => part !== undefined)
    .join(" ");
  const slug = text(person, "slug", "Personnel");
  return {
    column: "personnel_id",
    id: personnelId,
    link: {
      url: `/personnel/${slug}/${fragment === undefined ? "" : `#${fragment}`}`,
      label,
    },
  };
}

async function agencyTarget(
  read: AnnotationRowReader,
  agencyId: string,
): Promise<Target> {
  const agency = await read("Agency", agencyId);
  const place = await read(
    "LocationPath",
    text(agency, "location_path_id", "Agency"),
  );
  return {
    column: "agency_id",
    id: agencyId,
    link: {
      url: `${text(place, "path", "LocationPath")}${text(agency, "slug", "Agency")}/`,
      label: text(agency, "name", "Agency"),
    },
  };
}

async function reviewTarget(
  read: AnnotationRowReader,
  reviewId: string,
): Promise<Target> {
  const review = await read("Review", reviewId);
  const location = await read(
    "LocationPath",
    text(review, "location_path_id", "Review"),
  );
  const date = utcDate(review.incident_date);
  return {
    column: "review_id",
    id: reviewId,
    link: {
      url:
        date === undefined
          ? null
          : `${text(location, "path", "LocationPath")}reports/${date.replaceAll("-", "/")}/${text(review, "slug", "Review")}/`,
      label: text(review, "title", "Review"),
    },
  };
}

async function civilCaseTarget(
  read: AnnotationRowReader,
  civilCaseId: string,
): Promise<Target> {
  const civilCase = await read("CivilCase", civilCaseId);
  return {
    column: "civil_case_id",
    id: civilCaseId,
    link: {
      url: `/civil-cases/${text(civilCase, "slug", "CivilCase")}/`,
      label: text(civilCase, "title", "CivilCase"),
    },
  };
}

async function locationTarget(
  read: AnnotationRowReader,
  locationPathId: string,
): Promise<Target> {
  const location = await read("LocationPath", locationPathId);
  return {
    column: "location_path_id",
    id: locationPathId,
    link: {
      url: text(location, "path", "LocationPath"),
      label: text(location, "display_name", "LocationPath"),
    },
  };
}

async function federalAgencyTarget(
  read: AnnotationRowReader,
  federalAgencyId: string,
): Promise<Target> {
  const federalAgency = await read("FederalAgency", federalAgencyId);
  return {
    column: "federal_agency_id",
    id: federalAgencyId,
    link: {
      url: `/federal/${text(federalAgency, "slug", "FederalAgency")}/`,
      label: text(federalAgency, "name", "FederalAgency"),
    },
  };
}

async function authorityTarget(
  read: AnnotationRowReader,
  licensingAuthorityId: string,
): Promise<Target> {
  const authority = await read("LicensingAuthority", licensingAuthorityId);
  const location = await read(
    "LocationPath",
    text(authority, "location_path_id", "LicensingAuthority"),
  );
  return {
    column: "licensing_authority_id",
    id: licensingAuthorityId,
    link: {
      url:
        location.level === "state"
          ? `${text(location, "path", "LocationPath")}licensing-authority/`
          : null,
      label: text(authority, "name", "LicensingAuthority"),
    },
  };
}

async function assignmentTargets(
  read: AnnotationRowReader,
  agencyPersonnelId: string,
  fragment?: string,
): Promise<Target[]> {
  const assignment = await read("AgencyPersonnel", agencyPersonnelId);
  return [
    await personTarget(
      read,
      text(assignment, "personnel_id", "AgencyPersonnel"),
      fragment,
    ),
    await agencyTarget(read, text(assignment, "agency_id", "AgencyPersonnel")),
  ];
}

async function licenseTargets(
  read: AnnotationRowReader,
  licenseId: string,
): Promise<Target[]> {
  const license = await read("License", licenseId);
  const authorityLicense = await read(
    "AuthorityLicense",
    text(license, "authority_license_id", "License"),
  );
  return [
    await personTarget(read, text(license, "personnel_id", "License")),
    await authorityTarget(
      read,
      text(authorityLicense, "licensing_authority_id", "AuthorityLicense"),
    ),
  ];
}

// The records an annotation's subject connects, in display order. Fragments
// name the section of the person page that shows a record without a page of
// its own.
async function subjectTargets(
  kind: string,
  id: string,
  read: AnnotationRowReader,
): Promise<Target[]> {
  switch (kind) {
    case "Personnel":
    case "PersonnelPhoto":
      return [
        await personTarget(
          read,
          kind === "Personnel"
            ? id
            : text(await read(kind, id), "personnel_id", kind),
        ),
      ];
    case "PersonnelEducation":
      return [
        await personTarget(
          read,
          text(await read(kind, id), "personnel_id", kind),
          "personnel-education-records",
        ),
      ];
    case "AgencyPersonnel":
      return assignmentTargets(read, id, "agency-assignments");
    case "ArrestProfile":
    case "CoverageLinkAgencyPersonnel":
      return assignmentTargets(
        read,
        text(await read(kind, id), "agency_personnel_id", kind),
      );
    case "DisciplineAgencyPersonnel":
      return assignmentTargets(
        read,
        text(await read(kind, id), "agency_personnel_id", kind),
        "discipline",
      );
    case "Discipline": {
      const discipline = await read(kind, id);
      return [
        await personTarget(
          read,
          text(discipline, "personnel_id", kind),
          "discipline",
        ),
        await authorityTarget(
          read,
          text(discipline, "licensing_authority_id", kind),
        ),
      ];
    }
    case "License":
      return licenseTargets(read, id);
    case "LicenseAction":
      return licenseTargets(
        read,
        text(await read(kind, id), "license_id", kind),
      );
    case "CivilCasePersonnel": {
      const row = await read(kind, id);
      return [
        ...(await assignmentTargets(
          read,
          text(row, "agency_personnel_id", kind),
        )),
        await civilCaseTarget(read, text(row, "civil_case_id", kind)),
      ];
    }
    case "ReviewPersonnel": {
      const row = await read(kind, id);
      return [
        ...(await assignmentTargets(
          read,
          text(row, "agency_personnel_id", kind),
        )),
        await reviewTarget(read, text(row, "review_id", kind)),
      ];
    }
    case "Agency":
      return [await agencyTarget(read, id)];
    case "AgencyPhoneNumber":
    case "AgencyArrestProfile":
      return [
        await agencyTarget(read, text(await read(kind, id), "agency_id", kind)),
      ];
    case "CivilCase":
      return [await civilCaseTarget(read, id)];
    case "CivilCaseLink":
      return [
        await civilCaseTarget(
          read,
          text(await read(kind, id), "civil_case_id", kind),
        ),
      ];
    case "Review":
      return [await reviewTarget(read, id)];
    case "ReviewLink":
      return [
        await reviewTarget(read, text(await read(kind, id), "review_id", kind)),
      ];
    case "LocationPath":
      return [await locationTarget(read, id)];
    case "LocationPathGeometry":
    case "LocationPathAlias":
      return [
        await locationTarget(
          read,
          text(await read(kind, id), "location_path_id", kind),
        ),
      ];
    case "FederalAgency":
      return [await federalAgencyTarget(read, id)];
    case "LicensingAuthority":
      return [await authorityTarget(read, id)];
    case "AuthorityLicense":
      return [
        await authorityTarget(
          read,
          text(await read(kind, id), "licensing_authority_id", kind),
        ),
      ];
    default:
      throw new Error(
        `Annotation subject kind ${kind} has no page attachment rule.`,
      );
  }
}

/** The attachment and links of an annotation on the subject (kind, id). */
export async function annotationPage(
  kind: string,
  id: string,
  read: AnnotationRowReader,
): Promise<AnnotationPage> {
  const targets = await subjectTargets(kind, id, read);
  const attached = ATTACHMENT_PRIORITY.map((column) =>
    targets.find((target) => target.column === column),
  ).find((target) => target !== undefined);
  if (attached === undefined)
    throw new Error(`Annotation on ${kind} ${id} has no page attachment.`);
  const attachment = Object.fromEntries(
    ANNOTATION_ATTACHMENT_COLUMNS.map((column) => [
      column,
      column === attached.column ? attached.id : null,
    ]),
  ) as Record<AnnotationAttachmentColumn, string | null>;
  return { attachment, links: targets.map((target) => target.link) };
}

// A value the site shows for a reported or replacement value: text as it is,
// any other JSON as JSON text, and nothing for JSON null or for a field that
// holds an internal reference (id, or a column ending in _id other than a
// source_ column). For excluded_records the shown value is the excluded
// record's name. This is the website's former display rule, moved.
export function annotationDisplayValue(
  field: string,
  value: unknown,
): string | null {
  if ((field === "id" || field.endsWith("_id")) && !field.startsWith("source_"))
    return null;
  if (
    field === "excluded_records" &&
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value)
  ) {
    const name = (value as Row).name;
    if (typeof name === "string" && name.trim() !== "") return name;
  }
  if (value === null || value === undefined) return null;
  const shown = typeof value === "string" ? value : JSON.stringify(value);
  return shown.trim() === "" ? null : shown;
}
