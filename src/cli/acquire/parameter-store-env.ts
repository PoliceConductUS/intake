import { execFileSync } from "node:child_process";

// The API tokens that acquire sources read. Each lives only in AWS Systems
// Manager Parameter Store, as the SecureString `/policeconduct/secrets/<NAME>`.
export const PARAMETER_STORE_SECRETS: readonly string[] = [
  "CLEARING_HOUSE_API_TOKEN",
  "COURTLISTENER_API_TOKEN",
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

// Returns `env` with the acquire tokens resolved from Parameter Store the first
// time a source reads them. The stored value replaces any local value, and a
// source that reads neither token never contacts AWS.
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
