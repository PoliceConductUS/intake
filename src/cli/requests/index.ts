import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile } from "node:fs/promises";
import type { RegisterCliCommand } from "../../shared/cli/types.js";
import { describeSources } from "../describe-sources.js";
import {
  RequestStore,
  requestDefinitionSchema,
  submit,
  eligibility,
  assertCanSubmit,
} from "./lifecycle.js";
import { Resend } from "./resend.js";
import {
  portalFormSchema,
  portalProfileSchema,
  submitPortal,
} from "./portal.js";
import { createAnalyzer, syncMessages } from "./responses.js";
function required(name: string) {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is required`);
  return value;
}
async function loadSources(source?: string) {
  const root = path.join(process.cwd(), "sources");
  const catalog = (await describeSources(root)).filter(
    (entry) =>
      entry.phases.includes("request") && (!source || entry.id === source),
  );
  if (source && !catalog.length)
    throw new Error(`No request source: ${source}`);
  return Promise.all(
    catalog.map(async (entry) => {
      const module = await import(
        pathToFileURL(path.join(root, entry.id, "request.ts")).href
      );
      return {
        id: entry.id,
        definition: requestDefinitionSchema.parse(module.request),
        portalForm:
          module.portalForm === undefined
            ? undefined
            : portalFormSchema.parse(module.portalForm),
      };
    }),
  );
}
export const registerCliCommand: RegisterCliCommand = (
  program,
  dependencies,
) => {
  const run =
    <T extends unknown[]>(action: (...args: T) => Promise<void>) =>
    async (...args: T) => {
      try {
        await action(...args);
      } catch (error) {
        dependencies.setResult({
          exitCode: 1,
          stderr: `${error instanceof Error ? error.message : String(error)}\n`,
        });
      }
    };
  const group = program
    .command("requests")
    .description(
      "Submit periodic records requests and synchronize Resend response evidence",
    );
  group
    .command("submit <source>")
    .option("--force", "Override the 90-day submission interval")
    .action(
      run(async (source: string, options: { force?: boolean }) => {
        const [entry] = await loadSources(source);
        const store = new RequestStore(required("INTAKE_WORKSPACE"));
        await store.importHistory(entry.id, entry.definition);
        assertCanSubmit(
          await store.list(entry.id),
          new Date(),
          options.force === true,
        );
        if (entry.definition.channel.type === "email")
          required("RESEND_API_KEY");
        const portalProfile =
          entry.definition.channel.type === "portal"
            ? portalProfileSchema.parse(
                JSON.parse(required("RECORDS_REQUEST_CONTACT")),
              )
            : undefined;
        if (entry.definition.channel.type === "portal" && !entry.portalForm)
          throw new Error("Portal has no verified form definition");
        const row = await submit(store, {
          sourceId: entry.id,
          definition: entry.definition,
          now: new Date(),
          force: options.force === true,
          from: required("RECORDS_REQUEST_FROM"),
          receivingAddress: required("RECORDS_REQUEST_RECEIVING_ADDRESS"),
          requester: required("RECORDS_REQUEST_REQUESTER"),
          portalContact: portalProfile,
          standard: await readFile(
            path.join(process.cwd(), "docs/data-request-format.md"),
          ),
          send: (id, payload) =>
            new Resend(required("RESEND_API_KEY")).send(id, payload),
          sendPortal:
            entry.portalForm && portalProfile
              ? (id, payload) =>
                  submitPortal(
                    id,
                    payload,
                    portalProfileSchema.parse(payload.portalContact),
                    entry.portalForm!,
                    {
                      evidenceDirectory: path.join(
                        store.directory(entry.id),
                        "evidence",
                        id,
                      ),
                    },
                  )
              : undefined,
        });
        dependencies.setResult({
          exitCode: 0,
          stdout: `Submitted ${row.metadata.name}: ${row.spec.providerId}\n`,
        });
      }),
    );
  group
    .command("status [source]")
    .option("--json", "Output JSON")
    .action(
      run(async (source: string | undefined, options: { json?: boolean }) => {
        const entries = await loadSources(source);
        const store = new RequestStore(required("INTAKE_WORKSPACE"));
        for (const entry of entries)
          await store.importHistory(entry.id, entry.definition);
        const rows = (
          await Promise.all(entries.map((entry) => store.list(entry.id)))
        ).flat();
        const report = rows.map((row) => ({
          id: row.metadata.name,
          source: row.metadata.namespace,
          state: row.spec.state,
          submittedAt: row.spec.submittedAt ?? null,
          nextEligible:
            eligibility(row.spec.submittedAt, new Date(), false).next ?? null,
          submission: row.spec.submission,
          fulfillment: row.spec.fulfillment,
          disposition: row.spec.disposition,
          references: row.spec.references,
          evidence: [
            ...row.spec.evidence,
            ...row.spec.responses.map((response) => response.evidence),
          ],
        }));
        dependencies.setResult({
          exitCode: 0,
          stdout: options.json
            ? `${JSON.stringify(report, null, 2)}\n`
            : report
                .map(
                  (row) =>
                    `${row.source} ${row.id} | ${row.submission} ${row.submittedAt ?? "-"} | ${row.fulfillment}/${row.disposition} | next ${row.nextEligible ?? "-"} | refs ${row.references.join(", ") || "-"} | evidence ${row.evidence.join(", ")}`,
                )
                .join("\n") + "\n",
        });
      }),
    );
  group
    .command("sync [source]")
    .description("Save and interpret incoming Resend replies; never send mail")
    .option(
      "--request-id <id>",
      "Explicitly associate an email with this request",
    )
    .option("--email-id <id>", "Received email to associate with the request")
    .action(
      run(
        async (
          source: string | undefined,
          options: { requestId?: string; emailId?: string },
        ) => {
          if (Boolean(options.requestId) !== Boolean(options.emailId))
            throw new Error(
              "--request-id and --email-id must be supplied together",
            );
          const entries = await loadSources(source);
          const store = new RequestStore(required("INTAKE_WORKSPACE"));
          for (const entry of entries)
            await store.importHistory(entry.id, entry.definition);
          if (options.requestId) {
            const rows = (
              await Promise.all(entries.map((entry) => store.list(entry.id)))
            ).flat();
            if (!rows.some((row) => row.metadata.name === options.requestId))
              throw new Error("Request ID does not exist in selected sources");
          }
          const inbox = new Resend(required("RESEND_API_KEY_FULL_ACCESS"));
          const report = await syncMessages(
            store,
            entries.map((entry) => entry.id),
            inbox,
            required("RECORDS_REQUEST_RECEIVING_ADDRESS"),
            createAnalyzer(
              required("ANTHROPIC_API_KEY"),
              required("ANTHROPIC_MODEL"),
            ),
            options.emailId && options.requestId
              ? { [options.emailId]: options.requestId }
              : {},
          );
          dependencies.setResult({
            exitCode: 0,
            stdout: `${JSON.stringify(report, null, 2)}\n`,
          });
        },
      ),
    );
};
