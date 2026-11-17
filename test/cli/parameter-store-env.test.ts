import { describe, expect, it, vi } from "vitest";
import {
  PARAMETER_STORE_SECRETS,
  parameterName,
  withParameterStoreSecrets,
} from "../../src/cli/parameter-store-env.js";

describe("withParameterStoreSecrets", () => {
  it("names the acquire tokens it resolves", () => {
    expect(PARAMETER_STORE_SECRETS).toEqual([
      "ANTHROPIC_API_KEY",
      "CLEARING_HOUSE_API_TOKEN",
      "COURTLISTENER_API_TOKEN",
      "RESEND_API_KEY",
      "RESEND_API_KEY_FULL_ACCESS",
      "YOUTUBE_API_KEY",
    ]);
    expect(parameterName("COURTLISTENER_API_TOKEN")).toBe(
      "/policeconduct/secrets/COURTLISTENER_API_TOKEN",
    );
  });

  it("gives a source the stored token, read with the parameter's full name", () => {
    const read = vi.fn((name: string) => `stored:${name}\n`);
    const env = withParameterStoreSecrets({}, read);
    expect(env.COURTLISTENER_API_TOKEN).toBe(
      "stored:/policeconduct/secrets/COURTLISTENER_API_TOKEN",
    );
    expect(env.CLEARING_HOUSE_API_TOKEN).toBe(
      "stored:/policeconduct/secrets/CLEARING_HOUSE_API_TOKEN",
    );
    expect(read.mock.calls).toEqual([
      ["/policeconduct/secrets/COURTLISTENER_API_TOKEN"],
      ["/policeconduct/secrets/CLEARING_HOUSE_API_TOKEN"],
    ]);
  });

  it("uses the stored value in place of a stale local one", () => {
    const env = withParameterStoreSecrets(
      { COURTLISTENER_API_TOKEN: "stale-local-copy" },
      () => "stored",
    );
    expect(env.COURTLISTENER_API_TOKEN).toBe("stored");
  });

  it("passes other names through and reads nothing until a token is asked for", () => {
    const read = vi.fn(() => "stored");
    const env = withParameterStoreSecrets(
      { DATABASE_URL: "postgresql://local", INTAKE_WORKSPACE: "/workspace" },
      read,
    );
    expect(env.DATABASE_URL).toBe("postgresql://local");
    expect(env.INTAKE_WORKSPACE).toBe("/workspace");
    expect(env.COURTLISTENER_MIN_YEAR).toBeUndefined();
    expect(read).not.toHaveBeenCalled();
  });

  it("reads each token once", () => {
    const read = vi.fn(() => "stored");
    const env = withParameterStoreSecrets({}, read);
    expect(env.COURTLISTENER_API_TOKEN).toBe("stored");
    expect(env.COURTLISTENER_API_TOKEN).toBe("stored");
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("fails, naming the parameter, when the token cannot be read", () => {
    const env = withParameterStoreSecrets(
      { COURTLISTENER_API_TOKEN: "stale-local-copy" },
      () => {
        throw new Error("ParameterNotFound");
      },
    );
    expect(() => env.COURTLISTENER_API_TOKEN).toThrow(
      /Could not read \/policeconduct\/secrets\/COURTLISTENER_API_TOKEN from Parameter Store\..*ParameterNotFound/,
    );
  });

  it("fails when the stored token is empty", () => {
    for (const stored of ["", "  \n", "None"]) {
      const env = withParameterStoreSecrets({}, () => stored);
      expect(() => env.CLEARING_HOUSE_API_TOKEN).toThrow(
        "/policeconduct/secrets/CLEARING_HOUSE_API_TOKEN in Parameter Store is empty.",
      );
    }
  });
});
