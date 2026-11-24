import type { ClientDeps, ServiceSkips } from "./client-base.js";
import {
  createCourtListenerClient,
  type CourtListenerClient,
} from "./courtlistener-client.js";
import {
  createDownloadClient,
  type DownloadClient,
} from "./download-client.js";
import {
  createInferenceClient,
  type InferenceClient,
} from "./inference-client.js";
import {
  createPdfTextClient,
  type CommandRunner,
  type PdfTextClient,
} from "./pdf-text-client.js";

export type ServiceClients = {
  courtListener: CourtListenerClient;
  inference: InferenceClient;
  download: DownloadClient;
  pdfText: PdfTextClient;
  skips(): ServiceSkips[];
};

export function createServiceClients(
  deps: ClientDeps & {
    fetch: typeof fetch;
    env: Record<string, string | undefined>;
    runCommand?: CommandRunner;
  },
): ServiceClients {
  const courtListener = createCourtListenerClient({
    ...deps,
    readToken: () => deps.env.COURTLISTENER_API_TOKEN,
  });
  const inference = createInferenceClient({
    ...deps,
    readApiKey: () => deps.env.ANTHROPIC_API_KEY,
  });
  const download = createDownloadClient(deps);
  const pdfText = createPdfTextClient(deps);
  return {
    courtListener,
    inference,
    download,
    pdfText,
    skips: () => [
      ...courtListener.skips(),
      ...inference.skips(),
      ...download.skips(),
      ...pdfText.skips(),
    ],
  };
}
