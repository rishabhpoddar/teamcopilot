#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }

    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      args[key] = next;
      i++;
      continue;
    }

    args[key] = "true";
  }

  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function runCapture(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    stdio: ["ignore", "pipe", "inherit"],
    env: process.env,
    encoding: "utf8",
  }).trim();
}

function ensureRootPackageMatchesLockfile(packageJsonPath, packageLockPath) {
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const packageJsonVersion = packageJson.version;
  const packageLockVersion = packageLock.version;
  const packageLockRootVersion = packageLock.packages?.[""]?.version;
  const packageJsonSdkUrl = packageJson.dependencies?.["@opencode-ai/sdk"];
  const packageJsonRuntimeUrl = packageJson.dependencies?.["opencode-ai"];
  const packageLockSdkUrl = packageLock.packages?.[""]?.dependencies?.["@opencode-ai/sdk"];
  const packageLockRuntimeUrl = packageLock.packages?.[""]?.dependencies?.["opencode-ai"];
  const packageLockSdkResolved = packageLock.packages?.["node_modules/@opencode-ai/sdk"]?.resolved;
  const packageLockRuntimeResolved = packageLock.packages?.["node_modules/opencode-ai"]?.resolved;

  if (packageJsonVersion !== packageLockVersion || packageJsonVersion !== packageLockRootVersion) {
    throw new Error(
      `${path.relative(process.cwd(), packageJsonPath)} version ${packageJsonVersion} does not match ` +
      `${path.relative(process.cwd(), packageLockPath)} version ${packageLockVersion ?? "missing"} ` +
      `(root package version ${packageLockRootVersion ?? "missing"})`
    );
  }

  if (
    packageJsonSdkUrl !== packageLockSdkUrl ||
    packageJsonSdkUrl !== packageLockSdkResolved ||
    packageJsonRuntimeUrl !== packageLockRuntimeUrl ||
    packageJsonRuntimeUrl !== packageLockRuntimeResolved
  ) {
    throw new Error(
      `${path.relative(process.cwd(), packageJsonPath)} dependency URLs do not match ` +
      `${path.relative(process.cwd(), packageLockPath)}`
    );
  }
}

function ensureWorkspacePackageMatchesLockfile(packageJsonPath, packageLockPath) {
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const packageJsonDependency = packageJson.dependencies?.["opencode-ai"];
  const packageLockDependency = packageLock.packages?.[""]?.dependencies?.["opencode-ai"];
  const packageLockResolved = packageLock.packages?.["node_modules/opencode-ai"]?.resolved;

  if (packageJsonDependency !== packageLockDependency || packageJsonDependency !== packageLockResolved) {
    throw new Error(
      `${path.relative(process.cwd(), packageJsonPath)} opencode-ai dependency ${packageJsonDependency ?? "missing"} does not match ` +
      `${path.relative(process.cwd(), packageLockPath)} dependency ${packageLockDependency ?? "missing"} ` +
      `(resolved ${packageLockResolved ?? "missing"})`
    );
  }
}

function refreshLockfiles(repoRoot) {
  console.log("Refreshing TeamCopilot lockfiles...");
  run("npm", ["install", "--package-lock-only"], repoRoot);
  run("npm", ["install", "--package-lock-only"], path.join(repoRoot, "src/workspace_files"));
}

function validateNpmAuth(repoRoot) {
  const username = runCapture("npm", ["whoami"], repoRoot);
  if (username !== "trythisapp") {
    throw new Error(`Expected npm whoami to return trythisapp, got ${username}`);
  }
}

function validatePack(repoRoot) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-pack-"));
  try {
    run("npm", ["pack", "--json", "--pack-destination", tempDir], repoRoot);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

function releaseForkIfRequested(repoRoot, args) {
  if (args["with-opencode-fork"] !== "true") {
    return;
  }

  const forkArgs = ["run", "release:opencode-fork"];
  const passthroughFlags = [
    "fork-dir",
    "repo",
    "target",
    "notes",
    "release-dir",
    "release-tag",
    "skip-publish",
    "skip-teamcopilot",
  ];
  for (const flag of passthroughFlags) {
    if (args[flag] !== undefined) {
      forkArgs.push(`--${flag}`, String(args[flag]));
    }
  }

  if (args["dry-run"] === "true") {
    forkArgs.push("--dry-run");
  }

  forkArgs.splice(2, 0, "--");

  if (args["dry-run"] !== "true") {
    run("gh", ["auth", "status", "--hostname", "github.com"], repoRoot);
  }

  console.log("Releasing bundled OpenCode fork...");
  run("npm", forkArgs, repoRoot);
}

function publishTeamCopilot(repoRoot, args, version) {
  if (args["dry-run"] === "true" || args["skip-publish"] === "true") {
    console.log("Skipping npm publish for TeamCopilot");
    return;
  }

  const npmArgs = ["publish"];
  if (args.tag !== undefined) {
    npmArgs.push("--tag", String(args.tag));
  }
  if (args.otp !== undefined) {
    npmArgs.push("--otp", String(args.otp));
  }

  console.log(`Publishing TeamCopilot ${version} to npm...`);
  run("npm", npmArgs, repoRoot);
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = parseArgs(process.argv.slice(2));
const rootPackageJsonPath = path.join(repoRoot, "package.json");
const rootPackageLockPath = path.join(repoRoot, "package-lock.json");
const workspacePackageJsonPath = path.join(repoRoot, "src/workspace_files/package.json");
const workspacePackageLockPath = path.join(repoRoot, "src/workspace_files/package-lock.json");

console.log(`TeamCopilot release root: ${repoRoot}`);
console.log(`TeamCopilot version: ${readJson(rootPackageJsonPath).version}`);

if (args["with-opencode-fork"] === "true") {
  releaseForkIfRequested(repoRoot, args);
} else if (args["dry-run"] !== "true") {
  refreshLockfiles(repoRoot);
} else {
  console.log("Skipping lockfile refresh in dry-run mode");
}

ensureRootPackageMatchesLockfile(rootPackageJsonPath, rootPackageLockPath);
ensureWorkspacePackageMatchesLockfile(workspacePackageJsonPath, workspacePackageLockPath);

if (args["skip-checks"] !== "true") {
  if (args["skip-publish"] !== "true" && args["dry-run"] !== "true") {
    validateNpmAuth(repoRoot);
  }

  console.log("Running TeamCopilot tests...");
  run("npm", ["test"], repoRoot);

  console.log("Running TeamCopilot build...");
  run("npm", ["run", "build"], repoRoot);

  console.log("Validating npm package tarball...");
  validatePack(repoRoot);
} else {
  console.log("Skipping TeamCopilot tests and build");
}

publishTeamCopilot(repoRoot, args, readJson(rootPackageJsonPath).version);
console.log("Release workflow complete.");
