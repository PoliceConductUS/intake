import { setTimeout as sleep } from "node:timers/promises";
import {
  createServiceClients,
  type ServiceClients,
} from "../shared/services/index.js";
import { intakeVersion } from "./intake-version.js";
import { createCallCache } from "./state/call-cache/index.js";

/**
 * The service clients of one command (ADR 0039): their call results and files
 * are kept under `namespace`, and each outcome names `commandId`.
 */
export function buildServiceClients(input: {
  workspace: string;
  namespace: string;
  commandId: string;
  env: Record<string, string | undefined>;
  keepCachedCallResults?: boolean;
  logger?: { info(message: string): void };
}): ServiceClients {
  return createServiceClients({
    cache: createCallCache({
      rootDir: input.workspace,
      namespace: input.namespace,
      keepSucceeded: input.keepCachedCallResults,
    }),
    commandId: input.commandId,
    intakeVersion,
    now: () => new Date(),
    sleep: async (milliseconds) => {
      await sleep(milliseconds);
    },
    fetch,
    env: input.env,
    logger: input.logger,
  });
}
