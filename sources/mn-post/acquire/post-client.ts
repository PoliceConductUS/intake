import type {
  AgencyMatch,
  AgencyMatchResult,
  CollectLogger,
  OfficerDetail,
  OfficerRow,
  PostClient,
} from "./collect.js";

const LICENSE_SEARCH_URL =
  "https://mnitservices.my.site.com/POSTLicenseSearch/s/";

const silentLogger: CollectLogger = { info() {} };

type ApexActionSpec = {
  classname: string;
  method: string;
  params: Record<string, unknown>;
  cacheable?: boolean;
};

export type PostClientHandle = PostClient & { close(): Promise<void> };

/**
 * A live POST License Search client. The site is a Salesforce Experience site
 * that speaks the Aura/Apex protocol; we open a page in the caller's (headed,
 * human-verified) browser context to obtain an Aura context, then POST Apex
 * actions from within the page so they carry the page's verified session.
 */
export async function createPostLicenseSearchClient({
  context,
  logger = silentLogger,
}: {
  context: import("playwright").BrowserContext;
  logger?: CollectLogger;
}): Promise<PostClientHandle> {
  const page = await context.newPage();
  let auraContext: string | undefined;
  let requestCounter = 1;
  let actionCounter = 100;

  page.on("request", (request) => {
    if (!request.url().includes("/sfsites/aura")) return;
    const postData = request.postData();
    if (!postData) return;
    auraContext =
      new URLSearchParams(postData).get("aura.context") ?? auraContext;
  });

  // Lightning/Experience sites keep connections open, so "networkidle" often
  // never fires — load the DOM, then poll for the Aura context the app emits.
  logger.info("mn-post: opening POST license search…");
  await page.goto(LICENSE_SEARCH_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  logger.info(
    "mn-post: waiting for the POST license search app to initialize (solve any CAPTCHA in the window)…",
  );
  const deadline = Date.now() + 60_000;
  while (!auraContext && Date.now() < deadline) {
    await page.waitForTimeout(500);
  }
  if (!auraContext) {
    await page.close();
    throw new Error("POST license search did not expose an Aura context");
  }
  logger.info("mn-post: connected to POST license search");

  // Aura batches actions: one request carries many actions and returns their
  // results together. Sending an officer's four detail actions as one batch is a
  // single round-trip instead of four.
  async function executeApexActions(
    specs: ApexActionSpec[],
  ): Promise<unknown[]> {
    const actions = specs.map((spec) => {
      const action = {
        id: `${actionCounter};a`,
        descriptor: "aura://ApexActionController/ACTION$execute",
        callingDescriptor: "UNKNOWN",
        params: {
          namespace: "",
          classname: spec.classname,
          method: spec.method,
          params: spec.params,
          cacheable: spec.cacheable ?? false,
          isContinuation: false,
        },
      };
      actionCounter += 1;
      return action;
    });
    const body = new URLSearchParams({
      message: JSON.stringify({ actions }),
      "aura.context": auraContext ?? "",
      "aura.pageURI": "/POSTLicenseSearch/s/",
      "aura.token": "null",
    }).toString();
    const requestId = requestCounter;
    requestCounter += 1;
    const label = specs.map((spec) => spec.method).join(",");
    const response = await retryTransientAuraAction({
      method: label,
      logger,
      operation: () =>
        page.evaluate(
          async ({ url, body }) => {
            const result = await fetch(url, {
              method: "POST",
              headers: {
                "content-type":
                  "application/x-www-form-urlencoded;charset=UTF-8",
              },
              body,
            });
            return {
              ok: result.ok,
              status: result.status,
              text: await result.text(),
            };
          },
          {
            url: `/POSTLicenseSearch/s/sfsites/aura?r=${requestId}&aura.ApexAction.execute=1`,
            body,
          },
        ),
    });
    if (!response.ok) {
      throw new Error(
        `POST license search Aura request [${label}] failed: ${response.status}`,
      );
    }
    return parseApexActions(
      response.text,
      actions.map((action) => action.id),
      specs,
    );
  }

  async function executeApexAction(spec: ApexActionSpec): Promise<unknown> {
    const [value] = await executeApexActions([spec]);
    return value;
  }

  return {
    async searchAgency(agencyName: string): Promise<AgencyMatchResult> {
      const result = (await executeApexAction({
        classname: "POSTSearch",
        method: "getAgencies",
        params: { agency: agencyName, maxThreshold: "2000" },
      })) as { POSTAgencyList?: AgencyMatch[]; recordCount?: number };
      const candidateMatches = result.POSTAgencyList ?? [];
      assertCompleteResultCount(
        "getAgencies",
        result.recordCount,
        candidateMatches,
      );
      return {
        agencyName,
        recordCount: result.recordCount,
        candidateMatches,
        matches: selectExactAgencyMatches(agencyName, candidateMatches),
      };
    },
    async fetchOfficerList(agencyId: string): Promise<OfficerRow[]> {
      const result = (await executeApexAction({
        classname: "POSTSearch",
        method: "getLicensesByAgency",
        params: {
          agencyId,
          hasBeenDisciplined: false,
          maxThreshold: "2000",
        },
      })) as { POSTLicenseList?: OfficerRow[]; recordCount?: number };
      const officers = result.POSTLicenseList ?? [];
      assertCompleteResultCount(
        "getLicensesByAgency",
        result.recordCount,
        officers,
      );
      return officers;
    },
    async fetchOfficerDetails(
      officers: OfficerRow[],
    ): Promise<OfficerDetail[]> {
      if (officers.length === 0) return [];
      const values = await executeApexActions(
        officers.flatMap(officerDetailSpecs),
      );
      return officers.map((_, index) => {
        const base = index * DETAIL_ACTIONS_PER_OFFICER;
        return {
          education: values[base],
          disciplinaryActions: values[base + 1],
          activeEmployment: values[base + 2],
          licenses: values[base + 3],
        };
      });
    },
    async close(): Promise<void> {
      await page.close();
    },
  };
}

const DETAIL_ACTIONS_PER_OFFICER = 4;

function officerDetailSpecs(officer: OfficerRow): ApexActionSpec[] {
  return [
    {
      classname: "POSTSearchEducation",
      method: "getOfficerEducation",
      params: { contactId: officer.contactId },
      cacheable: true,
    },
    {
      classname: "POSTSearch",
      method: "getOfficerDisciplinaryActions",
      params: { contactId: officer.contactId },
      cacheable: true,
    },
    {
      classname: "POSTSearch",
      method: "getOfficerActiveEmployment",
      params: { licensePOId: officer.licenseId },
      cacheable: true,
    },
    {
      classname: "POSTSearch",
      method: "getOfficerLicenses",
      params: { contactId: officer.contactId },
      cacheable: true,
    },
  ];
}

export function parseApexActions(
  responseText: string,
  actionIds: string[],
  specs: ApexActionSpec[],
): unknown[] {
  const response = JSON.parse(responseText) as {
    actions?: Array<{
      id?: string;
      state?: string;
      returnValue?: { returnValue?: unknown };
    }>;
  };
  const returnedById = new Map(
    (response.actions ?? []).map((action) => [action.id, action]),
  );
  return actionIds.map((id, index) => {
    const action = returnedById.get(id);
    if (!action || action.state !== "SUCCESS") {
      throw new Error(
        `POST license search Aura action ${specs[index].method} did not succeed`,
      );
    }
    const value = action.returnValue?.returnValue;
    if (typeof value !== "string") return value;
    try {
      return JSON.parse(value);
    } catch {
      return value;
    }
  });
}

export function selectExactAgencyMatches(
  agencyName: string,
  matches: AgencyMatch[],
): AgencyMatch[] {
  const target = normalizeAgencyName(agencyName);
  return matches.filter(
    (match) => normalizeAgencyName(match.Organization_Name__c ?? "") === target,
  );
}

function normalizeAgencyName(name: string): string {
  return name
    .replace(/[\u200b-\u200d\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function assertCompleteResultCount(
  method: string,
  recordCount: number | undefined,
  records: readonly unknown[],
): void {
  if (typeof recordCount === "number" && recordCount !== records.length) {
    throw new Error(
      `POST license search Aura action ${method} returned ${records.length} of ${recordCount} records`,
    );
  }
}

async function retryTransientAuraAction<T>({
  method,
  operation,
  logger = silentLogger,
  maxAttempts = 3,
  sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms)),
}: {
  method: string;
  operation: () => Promise<T>;
  logger?: CollectLogger;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isTransientAuraError(error) || attempt === maxAttempts) throw error;
      logger.info(
        `mn-post: retrying transient Aura ${method} failure (attempt ${attempt})`,
      );
      await sleep(500 * attempt);
    }
  }
  throw lastError;
}

function isTransientAuraError(error: unknown): boolean {
  return /Failed to fetch|ERR_NETWORK|ERR_CONNECTION|Timeout/i.test(
    error instanceof Error ? error.message : String(error),
  );
}
