import { execFileSync } from "node:child_process";

// The API keys that the acquire and requests commands read. Each lives only in
// AWS Systems Manager Parameter Store, as the SecureString
// `/policeconduct/secrets/<NAME>`.
export const PARAMETER_STORE_SECRETS: readonly string[] = [
  "ANTHROPIC_API_KEY",
  "CLEARING_HOUSE_API_TOKEN",
  "COURTLISTENER_API_TOKEN",
  "RESEND_API_KEY",
  "RESEND_API_KEY_FULL_ACCESS",
  "YOUTUBE_API_KEY",
];

export type Environment = Record<string, string | undefined>;
export type ReadParameter = (parameterName: string) => string;

export function parameterName(secretName: string): string {
  return `/policeconduct/secrets/${secretName}`;
}

function readParameterWithAwsCli(env: Environment): ReadParameter {
  return (name) =>
    execFileSync(
      "aws",
      [
        "ssm",
        "get-parameter",
        "--region",
        "us-east-1",
        "--name",
        name,
        "--with-decryption",
        "--query",
        "Parameter.Value",
        "--output",
        "text",
        ...(env.AWS_PROFILE ? ["--profile", env.AWS_PROFILE] : []),
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
}

// Returns `env` with the API keys resolved from Parameter Store the first time
// each is read. The stored value replaces any local value, and a command that
// reads none of them never contacts AWS.
export function withParameterStoreSecrets(
  env: Environment,
  read: ReadParameter = readParameterWithAwsCli(env),
): Environment {
  const resolved = new Map<string, string>();
  return new Proxy(env, {
    get(target, property, receiver) {
      if (
        typeof property !== "string" ||
        !PARAMETER_STORE_SECRETS.includes(property)
      ) {
        return Reflect.get(target, property, receiver) as unknown;
      }
      const cached = resolved.get(property);
      if (cached !== undefined) return cached;
      const name = parameterName(property);
      let value: string;
      try {
        value = read(name).trim();
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Could not read ${name} from Parameter Store. Check AWS_PROFILE and that the parameter exists. ${detail}`,
        );
      }
      if (value === "" || value === "None") {
        throw new Error(`${name} in Parameter Store is empty.`);
      }
      resolved.set(property, value);
      return value;
    },
  });
}
