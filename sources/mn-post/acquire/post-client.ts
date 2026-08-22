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

  await page.goto(LICENSE_SEARCH_URL, {
    waitUntil: "networkidle",
    timeout: 60_000,
  });
  if (!auraContext) await page.waitForTimeout(1_000);
  if (!auraContext) {
    await page.close();
    throw new Error("POST license search did not expose an Aura context");
  }

  async function executeApexAction({
    classname,
    method,
    params,
    cacheable = false,
  }: {
    classname: string;
    method: string;
    params: Record<string, unknown>;
    cacheable?: boolean;
  }): Promise<unknown> {
    const action = {
      id: `${actionCounter};a`,
      descriptor: "aura://ApexActionController/ACTION$execute",
      callingDescriptor: "UNKNOWN",
      params: {
        namespace: "",
        classname,
        method,
        params,
        cacheable,
        isContinuation: false,
      },
    };
    actionCounter += 1;
    const body = new URLSearchParams({
      message: JSON.stringify({ actions: [action] }),
      "aura.context": auraContext ?? "",
      "aura.pageURI": "/POSTLicenseSearch/s/",
      "aura.token": "null",
    }).toString();
    const requestId = requestCounter;
    requestCounter += 1;
    const response = await retryTransientAuraAction({
      method,
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
        `POST license search Aura action ${method} failed: ${response.status}`,
      );
    }
    return parseApexReturnValue(response.text, method);
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
    async fetchOfficerList(match: AgencyMatch): Promise<OfficerRow[]> {
      const result = (await executeApexAction({
        classname: "POSTSearch",
        method: "getLicensesByAgency",
        params: {
          agencyId: match.Id,
          hasBeenDisciplined: false,
          contactIdCleo: match.Licensee__c,
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
    async fetchOfficerDetail(officer: OfficerRow): Promise<OfficerDetail> {
      // Sequential, one Apex action at a time, to stay gentle on the site.
      const education = await executeApexAction({
        classname: "POSTSearchEducation",
        method: "getOfficerEducation",
        params: { contactId: officer.contactId },
        cacheable: true,
      });
      const disciplinaryActions = await executeApexAction({
        classname: "POSTSearch",
        method: "getOfficerDisciplinaryActions",
        params: { contactId: officer.contactId },
        cacheable: true,
      });
      const activeEmployment = await executeApexAction({
        classname: "POSTSearch",
        method: "getOfficerActiveEmployment",
        params: { licensePOId: officer.licenseId },
        cacheable: true,
      });
      const licenses = await executeApexAction({
        classname: "POSTSearch",
        method: "getOfficerLicenses",
        params: { contactId: officer.contactId },
        cacheable: true,
      });
      return { education, disciplinaryActions, activeEmployment, licenses };
    },
    async close(): Promise<void> {
      await page.close();
    },
  };
}

export function parseApexReturnValue(
  responseText: string,
  method: string,
): unknown {
  const response = JSON.parse(responseText) as {
    actions?: Array<{
      state?: string;
      returnValue?: { returnValue?: unknown };
    }>;
  };
  const action = response.actions?.[0];
  if (!action || action.state !== "SUCCESS") {
    throw new Error(
      `POST license search Aura action ${method} did not succeed`,
    );
  }
  const value = action.returnValue?.returnValue;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
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
