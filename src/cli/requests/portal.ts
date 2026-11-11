import { z } from "zod";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  portalContactSchema as portalProfileSchema,
  type RequestPayload,
} from "../../shared/io/RecordsRequest.js";
import { SubmissionRejectedError } from "./lifecycle.js";
const text = z.string().min(1);
export { portalContactSchema as portalProfileSchema } from "../../shared/io/RecordsRequest.js";
export type PortalProfile = z.infer<typeof portalProfileSchema>;
const targetSchema = z.union([
  z.object({ selector: text }).strict(),
  z.object({ label: text }).strict(),
  z
    .object({
      role: z.enum(["button", "checkbox", "combobox", "option"]),
      name: text,
    })
    .strict(),
]);
const fieldSchema = z.enum([
  "firstName",
  "lastName",
  "email",
  "phone",
  "organization",
  "street",
  "city",
  "state",
  "zip",
  "requestText",
]);
export const portalFormSchema = z
  .object({
    url: z.url(),
    actions: z
      .array(
        z.discriminatedUnion("type", [
          z
            .object({
              type: z.literal("fill"),
              target: targetSchema,
              field: fieldSchema,
            })
            .strict(),
          z.object({ type: z.literal("click"), target: targetSchema }).strict(),
          z
            .object({
              type: z.literal("select"),
              target: targetSchema,
              field: fieldSchema,
            })
            .strict(),
        ]),
      )
      .min(1),
    submit: targetSchema,
    successText: text,
    blockers: z.array(targetSchema),
  })
  .strict()
  .refine(
    (form) =>
      form.actions.some(
        (action) => action.type === "fill" && action.field === "requestText",
      ),
    "Portal form must include complete request text",
  );
export type PortalForm = z.infer<typeof portalFormSchema>;
interface PortalLocator {
  fill(value: string): Promise<unknown>;
  inputValue(): Promise<string>;
  click(): Promise<unknown>;
  selectOption(value: string): Promise<unknown>;
  isVisible(): Promise<boolean>;
  waitFor(options: { state: "visible"; timeout: number }): Promise<unknown>;
  innerText(): Promise<string>;
}
export interface PortalPage {
  goto(url: string): Promise<unknown>;
  locator(selector: string): PortalLocator;
  getByLabel(label: string, options: { exact: true }): PortalLocator;
  getByRole(
    role: "button" | "checkbox" | "combobox" | "option",
    options: { name: string; exact: true },
  ): PortalLocator;
  getByText(text: string, options: { exact: true }): PortalLocator;
  url(): string;
  screenshot(options: { fullPage: true }): Promise<Buffer>;
}
export type PortalBrowser = { page: PortalPage; close(): Promise<void> };
async function openBrowser(): Promise<PortalBrowser> {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(30000);
    return { page, close: () => browser.close() };
  } catch (error) {
    await browser.close();
    throw error;
  }
}
export async function submitPortal(
  id: string,
  payload: RequestPayload,
  profileInput: PortalProfile,
  formInput: PortalForm,
  options: {
    evidenceDirectory: string;
    openBrowser?: () => Promise<PortalBrowser>;
  },
): Promise<{ id: string; evidence: string[] }> {
  let browser: PortalBrowser | undefined;
  let submissionAttempted = false;
  try {
    const profile = portalProfileSchema.parse(profileInput);
    const form = portalFormSchema.parse(formInput);
    if (profile.email !== payload.reply_to)
      throw new Error("Portal contact email must match the receiving address");
    if (payload.to !== form.url)
      throw new Error("Portal destination differs from saved payload");
    const requestText = [
      payload.subject,
      payload.text,
      ...payload.attachments.map((attachment) =>
        new TextDecoder("utf-8", { fatal: true }).decode(
          Buffer.from(attachment.content, "base64"),
        ),
      ),
    ].join("\n\n");
    const values = { ...profile, requestText };
    await mkdir(options.evidenceDirectory, { recursive: true });
    browser = await (options.openBrowser ?? openBrowser)();
    const page = browser.page;
    const locate = (target: z.infer<typeof targetSchema>) =>
      "selector" in target
        ? page.locator(target.selector)
        : "label" in target
          ? page.getByLabel(target.label, { exact: true })
          : page.getByRole(target.role, { name: target.name, exact: true });
    const checkBlockers = async () => {
      for (const target of form.blockers)
        if (await locate(target).isVisible())
          throw new Error("Portal challenge blocks automated submission");
    };
    await page.goto(form.url);
    await checkBlockers();
    for (const action of form.actions) {
      const locator = locate(action.target);
      if (action.type === "click") await locator.click();
      else if (action.type === "select")
        await locator.selectOption(values[action.field]);
      else await locator.fill(values[action.field]);
    }
    for (const action of form.actions) {
      if (
        action.type !== "click" &&
        (await locate(action.target).inputValue()) !== values[action.field]
      )
        throw new Error(`Portal field readback mismatch: ${action.field}`);
    }
    await checkBlockers();
    submissionAttempted = true;
    await locate(form.submit).click();
    const confirmation = page.getByText(form.successText, { exact: true });
    await confirmation.waitFor({ state: "visible", timeout: 30000 });
    const observed = await confirmation.innerText();
    if (observed.trim() !== form.successText)
      throw new Error("Portal confirmation text mismatch");
    const receiptPath = path.join(
      options.evidenceDirectory,
      "portal-confirmation.json",
    );
    const screenshotPath = path.join(
      options.evidenceDirectory,
      "portal-confirmation.png",
    );
    await writeFile(screenshotPath, await page.screenshot({ fullPage: true }));
    await writeFile(
      receiptPath,
      JSON.stringify(
        {
          requestId: id,
          url: page.url(),
          confirmation: observed,
          recordedAt: new Date().toISOString(),
          screenshot: screenshotPath,
        },
        null,
        2,
      ),
    );
    return {
      id: `portal-confirmation:${id}`,
      evidence: [receiptPath, screenshotPath],
    };
  } catch (error) {
    if (!submissionAttempted)
      throw new SubmissionRejectedError(
        error instanceof Error ? error.message : String(error),
        { cause: error },
      );
    throw error;
  } finally {
    await browser?.close();
  }
}
