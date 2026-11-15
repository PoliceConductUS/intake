#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const ignoredDirs = new Set([
  ".astro",
  ".cache",
  ".git",
  ".worktrees",
  "dist",
  "node_modules",
  "test-results",
  "worktrees",
]);

function parseArgs(argv) {
  const args = {
    all: false,
    dryRun: false,
    log: "upgrade.log",
    root: ".",
    target: "patch",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--all") {
      args.all = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--root") {
      args.root = argv[++index];
    } else if (arg === "--target") {
      args.target = argv[++index];
    } else if (arg === "--log") {
      args.log = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  if (!["latest", "minor", "patch"].includes(args.target)) {
    throw new Error("--target must be latest, minor, or patch");
  }

  if (args.all && args.root !== ".") {
    throw new Error("Use either --all or --root, not both");
  }

  return args;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
  });
  return {
    ok: result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`,
    status: result.status ?? 1,
  };
}

function logLine(logPath, line) {
  const timestamp = new Date().toISOString();
  writeFileSync(logPath, `${timestamp} ${line}\n`, { flag: "a" });
}

function findPackageRoots(startDir) {
  const roots = [];

  function visit(dir) {
    const entries = readdirSync(dir, { withFileTypes: true });
    if (
      entries.some((entry) => entry.isFile() && entry.name === "package.json")
    ) {
      roots.push(dir);
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || ignoredDirs.has(entry.name)) continue;
      visit(join(dir, entry.name));
    }
  }

  visit(startDir);
  return roots.sort((a, b) => {
    const depthA = relative(startDir, a).split("/").filter(Boolean).length;
    const depthB = relative(startDir, b).split("/").filter(Boolean).length;
    return depthA - depthB || a.localeCompare(b);
  });
}

function packageLabel(packageRoot) {
  const relativePath = relative(repoRoot, packageRoot) || ".";
  if (relativePath === ".") return "root";

  return basename(packageRoot);
}

function readPackage(packageRoot) {
  return JSON.parse(
    Buffer.from(
      spawnSync(
        "node",
        [
          "-e",
          "process.stdout.write(require('fs').readFileSync('package.json'))",
        ],
        {
          cwd: packageRoot,
        },
      ).stdout,
    ).toString("utf8"),
  );
}

function restorePackageFiles(packageRoot) {
  const files = ["package.json"];
  if (existsSync(join(packageRoot, "package-lock.json"))) {
    files.push("package-lock.json");
  }

  run("git", ["restore", "--", ...files], { cwd: packageRoot });
  run("npm", ["install"], { cwd: packageRoot });
}

function validatePackage(packageRoot, logPath) {
  const packageJson = readPackage(packageRoot);
  if (packageJson.scripts?.validate) {
    logLine(logPath, "Running npm run validate");
    return run("npm", ["run", "validate"], { cwd: packageRoot });
  }

  logLine(logPath, "No validate script found; running npm audit --omit=dev");
  return run("npm", ["audit", "--omit=dev"], { cwd: packageRoot });
}

function commitPackage(packageRoot, packageName, packageVersion, logPath) {
  const files = ["package.json"];
  if (existsSync(join(packageRoot, "package-lock.json"))) {
    files.push("package-lock.json");
  }

  const add = run("git", ["add", ...files], { cwd: packageRoot });
  if (!add.ok) return add;

  const label = packageLabel(packageRoot);
  const message = `chore(deps): update ${label} ${packageName} to ${packageVersion}`;
  logLine(logPath, `Committing: ${message}`);
  return run("git", ["commit", "-m", message], { cwd: packageRoot });
}

function updatePackageRoot(packageRoot, options) {
  const logPath = resolve(repoRoot, options.log);
  const displayRoot = relative(repoRoot, packageRoot) || ".";
  console.log(`\n==> ${displayRoot}`);
  logLine(logPath, `Processing ${displayRoot}`);

  const list = run(
    "npx",
    ["-y", "npm-check-updates", "--target", options.target, "--jsonUpgraded"],
    { cwd: packageRoot },
  );
  if (!list.ok) {
    logLine(
      logPath,
      `npm-check-updates failed for ${displayRoot}\n${list.output}`,
    );
    return { failed: 1, succeeded: 0 };
  }

  const upgrades = JSON.parse(list.output || "{}");
  const entries = Object.entries(upgrades);
  if (entries.length === 0) {
    console.log("No package updates found.");
    logLine(logPath, `No package updates found for ${displayRoot}`);
    return { failed: 0, succeeded: 0 };
  }

  let failed = 0;
  let succeeded = 0;

  for (const [packageName, packageVersion] of entries) {
    const prefix = `${displayRoot}: ${packageName} -> ${packageVersion}`;
    console.log(prefix);
    logLine(logPath, `Updating ${prefix}`);

    if (options.dryRun) {
      continue;
    }

    const update = run(
      "npx",
      [
        "-y",
        "npm-check-updates",
        "-u",
        "--target",
        options.target,
        packageName,
      ],
      { cwd: packageRoot },
    );
    if (!update.ok) {
      logLine(logPath, `Update failed for ${prefix}\n${update.output}`);
      restorePackageFiles(packageRoot);
      failed += 1;
      continue;
    }

    const install = run("npm", ["install"], { cwd: packageRoot });
    if (!install.ok) {
      logLine(logPath, `npm install failed for ${prefix}\n${install.output}`);
      restorePackageFiles(packageRoot);
      failed += 1;
      continue;
    }

    const validation = validatePackage(packageRoot, logPath);
    if (!validation.ok) {
      logLine(logPath, `Validation failed for ${prefix}\n${validation.output}`);
      restorePackageFiles(packageRoot);
      failed += 1;
      continue;
    }

    const commit = commitPackage(
      packageRoot,
      packageName,
      packageVersion,
      logPath,
    );
    if (!commit.ok) {
      logLine(logPath, `Commit failed for ${prefix}\n${commit.output}`);
      run(
        "git",
        ["restore", "--staged", "--", "package.json", "package-lock.json"],
        {
          cwd: packageRoot,
        },
      );
      restorePackageFiles(packageRoot);
      failed += 1;
      continue;
    }

    succeeded += 1;
  }

  return { failed, succeeded };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const roots = options.all
    ? findPackageRoots(repoRoot)
    : [resolve(repoRoot, options.root)];

  mkdirSync(resolve(repoRoot, ".cache"), { recursive: true });
  writeFileSync(resolve(repoRoot, options.log), "", { flag: "a" });

  let failed = 0;
  let succeeded = 0;
  for (const packageRoot of roots) {
    if (!existsSync(join(packageRoot, "package.json"))) {
      throw new Error(`package.json not found in ${packageRoot}`);
    }
    const result = updatePackageRoot(packageRoot, options);
    failed += result.failed;
    succeeded += result.succeeded;
  }

  console.log(
    `\nDependency updates complete. Successful: ${succeeded}. Failed: ${failed}.`,
  );
  process.exit(failed > 0 ? 1 : 0);
}

main();
