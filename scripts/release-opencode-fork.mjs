#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawn } from "node:child_process";
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

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function run(command, args, cwd) {
  execFileSync(command, args, {
    cwd,
    stdio: "inherit",
    env: process.env,
  });
}

function runUntilStarted(command, args, cwd, readyPatterns, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let collectedOutput = "";
    let readyCount = 0;
    let settled = false;
    let killed = false;
    const readySeen = new Set();

    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      child.stdout?.off("data", onStdoutData);
      child.stderr?.off("data", onStderrData);
      child.off("error", onError);
      child.off("exit", onExit);
      if (error) reject(error);
      else resolve();
    };

    const onStdoutData = (chunk) => {
      const text = chunk.toString();
      process.stdout.write(text);
      collectedOutput += text;
      for (const pattern of readyPatterns) {
        if (!readySeen.has(pattern) && collectedOutput.includes(pattern)) {
          readySeen.add(pattern);
          readyCount++;
        }
      }
      if (readyCount === readyPatterns.length && !killed) {
        killed = true;
        child.kill("SIGINT");
      }
    };

    const onStderrData = (chunk) => {
      process.stderr.write(chunk);
    };

    const onError = (error) => {
      finish(error);
    };

    const onExit = (code, signal) => {
      if (readyCount === readyPatterns.length) {
        if (code === 0 || signal === "SIGINT") {
          finish();
          return;
        }
        finish(new Error(`Command ${command} exited unexpectedly after startup with code ${code ?? "null"} signal ${signal ?? "null"}`));
        return;
      }

      finish(
        new Error(
          `Command ${command} exited before startup completed with code ${code ?? "null"} signal ${signal ?? "null"}.\n\nOutput:\n${collectedOutput}`,
        ),
      );
    };

    const timeout = setTimeout(() => {
      if (!killed) {
        killed = true;
        child.kill("SIGINT");
      }
      finish(new Error(`Timed out waiting for ${readyPatterns.join(" and ")} after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout?.on("data", onStdoutData);
    child.stderr?.on("data", onStderrData);
    child.on("error", onError);
    child.on("exit", onExit);
  });
}

function cleanupTgzFiles(dir) {
  if (!fs.existsSync(dir)) {
    return;
  }

  for (const entry of fs.readdirSync(dir)) {
    if (entry.endsWith(".tgz") || entry.endsWith(".tar.gz")) {
      fs.rmSync(path.join(dir, entry), { force: true });
    }
  }
}

function copyFile(source, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
}

function rewriteSdkPackageForPack(packageJsonPath) {
  const original = readJson(packageJsonPath);
  const next = JSON.parse(JSON.stringify(original));

  function transformExports(exports) {
    for (const [key, value] of Object.entries(exports)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        transformExports(value);
      } else if (typeof value === "string") {
        const file = value.replace("./src/", "./dist/").replace(/\.ts$/, "");
        exports[key] = {
          import: `${file}.js`,
          types: `${file}.d.ts`,
        };
      }
    }
  }

  transformExports(next.exports);
  writeJson(packageJsonPath, next);
  return original;
}

function listTgzFiles(dir) {
  return fs.readdirSync(dir).filter((entry) => entry.endsWith(".tgz"));
}

function findSingleTgzFile(dir) {
  const tgzFiles = listTgzFiles(dir);
  if (tgzFiles.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${dir}, found ${tgzFiles.join(", ") || "none"}`);
  }

  return tgzFiles[0];
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const args = parseArgs(process.argv.slice(2));

const forkDir = path.resolve(repoRoot, args["fork-dir"] ?? "opencode-fork");
const releaseRepo = args.repo ?? "rishabhpoddar/opencode";
const releaseTarget = args.target ?? "teamcopilot-1.3.7-changes";
const releaseNotes = args.notes ?? "TeamCopilot forked OpenCode tarballs";
const releaseDir = path.resolve(args["release-dir"] ?? path.join(os.tmpdir(), `opencode-release-${Date.now()}`));
const skipPublish = args["skip-publish"] === "true" || args["dry-run"] === "true";
const skipTeamcopilot = args["skip-teamcopilot"] === "true" || args["dry-run"] === "true";
const explicitReleaseTag = args["release-tag"];

const sdkDir = path.join(forkDir, "packages/sdk/js");
const opencodeDir = path.join(forkDir, "packages/opencode");
const distDir = path.join(opencodeDir, "dist");
const rootPackageJsonPath = path.join(repoRoot, "package.json");
const workspacePackageJsonPath = path.join(repoRoot, "src/workspace_files/package.json");
const releaseHelperPath = path.join(repoRoot, "src/utils/opencode-release.ts");

fs.mkdirSync(releaseDir, { recursive: true });

const createdArtifacts = [];
const cleanupPaths = new Set();

try {
  console.log(`Using fork checkout: ${forkDir}`);
  console.log(`Temporary release dir: ${releaseDir}`);

  console.log("Building OpenCode SDK package...");
  run("bun", ["run", "--cwd", sdkDir, "build"], repoRoot);
  cleanupTgzFiles(sdkDir);
  const sdkPackageJsonPath = path.join(sdkDir, "package.json");
  const sdkPackageJsonBackup = rewriteSdkPackageForPack(sdkPackageJsonPath);
  try {
    run("npm", ["pack"], sdkDir);
  } finally {
    writeJson(sdkPackageJsonPath, sdkPackageJsonBackup);
  }
  const sdkTarballName = findSingleTgzFile(sdkDir);
  const sdkReleaseName = "opencode-ai-sdk.tgz";
  const sdkReleasePath = path.join(releaseDir, sdkReleaseName);
  copyFile(path.join(sdkDir, sdkTarballName), sdkReleasePath);
  createdArtifacts.push(sdkReleasePath);
  cleanupPaths.add(path.join(sdkDir, sdkTarballName));

  console.log("Building OpenCode runtime package...");
  run("bun", ["run", "--cwd", opencodeDir, "build"], repoRoot);

  cleanupTgzFiles(distDir);
  const platformDirs = fs
    .readdirSync(distDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "opencode")
    .map((entry) => entry.name)
    .sort();

  if (platformDirs.length === 0) {
    throw new Error(`No runtime package directories were built in ${distDir}`);
  }

  const runtimeVersion = readJson(path.join(distDir, platformDirs[0], "package.json")).version;
  const releaseTag = explicitReleaseTag ?? String(runtimeVersion).replace(/^0\.0\.0-/, "");
  if (!skipPublish) {
    try {
      execFileSync(
        "gh",
        ["release", "view", releaseTag, "--repo", releaseRepo, "--json", "tagName"],
        { cwd: repoRoot, stdio: "pipe", encoding: "utf8" },
      );
      throw new Error(`GitHub release ${releaseTag} already exists in ${releaseRepo}`);
    } catch (error) {
      if (error instanceof Error && "status" in error) {
        const status = Number(error.status);
        if (status !== 1) {
          throw error;
        }
      }
    }
  }

  const runtimeReleaseDir = path.join(distDir, "opencode");
  fs.rmSync(runtimeReleaseDir, { recursive: true, force: true });
  fs.mkdirSync(path.join(runtimeReleaseDir, "bin"), { recursive: true });

  const runtimePackageJson = {
    name: "opencode-ai",
    bin: {
      opencode: "./bin/opencode",
    },
    scripts: {
      postinstall: "bun ./postinstall.mjs || node ./postinstall.mjs",
    },
    version: runtimeVersion,
    license: readJson(path.join(opencodeDir, "package.json")).license,
  };

  copyFile(path.join(opencodeDir, "bin", "opencode"), path.join(runtimeReleaseDir, "bin", "opencode"));
  copyFile(path.join(opencodeDir, "script", "postinstall.mjs"), path.join(runtimeReleaseDir, "postinstall.mjs"));
  copyFile(path.join(forkDir, "LICENSE"), path.join(runtimeReleaseDir, "LICENSE"));

  for (const platformDir of platformDirs) {
    const fullPlatformDir = path.join(distDir, platformDir);
    cleanupTgzFiles(fullPlatformDir);
    run("bun", ["pm", "pack"], fullPlatformDir);
    const tarballName = findSingleTgzFile(fullPlatformDir);
    const releaseTarballPath = path.join(releaseDir, tarballName);
    copyFile(path.join(fullPlatformDir, tarballName), releaseTarballPath);
    createdArtifacts.push(releaseTarballPath);
    cleanupPaths.add(path.join(fullPlatformDir, tarballName));
  }

  writeJson(path.join(runtimeReleaseDir, "package.json"), runtimePackageJson);

  for (const artifactPath of createdArtifacts.filter((filePath) => path.basename(filePath) !== sdkReleaseName)) {
    const sourcePath = artifactPath;
    const targetPath = path.join(runtimeReleaseDir, path.basename(artifactPath));
    copyFile(sourcePath, targetPath);
    cleanupPaths.add(targetPath);
  }

  run("bun", ["pm", "pack"], runtimeReleaseDir);
  const runtimeTarballName = listTgzFiles(runtimeReleaseDir).find(
    (entry) => entry.startsWith("opencode-ai-") && entry.endsWith(".tgz"),
  );
  if (!runtimeTarballName) {
    throw new Error(`Expected opencode-ai tarball in ${runtimeReleaseDir}`);
  }
  const runtimeReleasePath = path.join(releaseDir, "opencode-ai.tgz");
  copyFile(path.join(runtimeReleaseDir, runtimeTarballName), runtimeReleasePath);
  createdArtifacts.push(runtimeReleasePath);
  cleanupPaths.add(path.join(runtimeReleaseDir, runtimeTarballName));

  console.log(`Created release artifacts for ${releaseTag}`);
  for (const artifact of createdArtifacts) {
    console.log(`- ${artifact}`);
  }

  if (!skipPublish) {
    console.log(`Publishing GitHub release ${releaseTag}...`);
    run(
      "gh",
      [
        "release",
        "create",
        releaseTag,
        "--repo",
        releaseRepo,
        "--target",
        releaseTarget,
        "--title",
        releaseTag,
        "--notes",
        releaseNotes,
        path.join(releaseDir, "opencode-ai-sdk.tgz"),
        path.join(releaseDir, "opencode-ai.tgz"),
      ],
      repoRoot,
    );
  } else {
    console.log(`Skipping GitHub publish for ${releaseTag}`);
  }

  if (!skipTeamcopilot) {
    const releaseBaseUrl = `https://github.com/${releaseRepo}/releases/download/${releaseTag}`;

    const rootPackageJson = readJson(rootPackageJsonPath);
    rootPackageJson.dependencies["@opencode-ai/sdk"] = `${releaseBaseUrl}/opencode-ai-sdk.tgz`;
    rootPackageJson.dependencies["opencode-ai"] = `${releaseBaseUrl}/opencode-ai.tgz`;
    writeJson(rootPackageJsonPath, rootPackageJson);

    const workspacePackageJson = readJson(workspacePackageJsonPath);
    workspacePackageJson.dependencies["opencode-ai"] = `${releaseBaseUrl}/opencode-ai.tgz`;
    writeJson(workspacePackageJsonPath, workspacePackageJson);

    fs.writeFileSync(
      releaseHelperPath,
      fs
        .readFileSync(releaseHelperPath, "utf8")
        .replace(
          /const OPENCODE_RELEASE_TAG = ".*?";/,
          `const OPENCODE_RELEASE_TAG = "${releaseTag}";`,
        ),
      "utf8",
    );

    console.log("Regenerating TeamCopilot lockfiles...");
    run("npm", ["install", "--package-lock-only"], repoRoot);
    run("npm", ["install", "--package-lock-only"], path.join(repoRoot, "src/workspace_files"));

    console.log("Smoke testing TeamCopilot dev startup...");
    await runUntilStarted(
      "npm",
      ["run", "dev"],
      repoRoot,
      ["Opencode server running at", "Server running at http://"],
    );
  } else {
    console.log("Skipping TeamCopilot URL and lockfile updates");
  }

  console.log("Release workflow complete.");
} finally {
  for (const cleanupPath of cleanupPaths) {
    fs.rmSync(cleanupPath, { force: true });
  }
}
