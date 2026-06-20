import assert from "node:assert/strict";
import path from "node:path";

const {
    opencodeNativePackageBase,
    opencodeBinaryName,
    selectOpencodeNativeTarball,
    opencodeBinaryCachePaths,
} = require("../src/utils/opencode-bin") as typeof import("../src/utils/opencode-bin");

// The real opencode-ai package bundles this full matrix of native tarballs.
const TAG = "0.0.0-teamcopilot-1.3.7-changes-202605280640";
const FULL_MATRIX = [
    `opencode-darwin-arm64-${TAG}.tgz`,
    `opencode-darwin-x64-${TAG}.tgz`,
    `opencode-darwin-x64-baseline-${TAG}.tgz`,
    `opencode-linux-arm64-${TAG}.tgz`,
    `opencode-linux-arm64-musl-${TAG}.tgz`,
    `opencode-linux-x64-${TAG}.tgz`,
    `opencode-linux-x64-baseline-${TAG}.tgz`,
    `opencode-linux-x64-baseline-musl-${TAG}.tgz`,
    `opencode-linux-x64-musl-${TAG}.tgz`,
    `opencode-windows-arm64-${TAG}.tgz`,
    `opencode-windows-x64-${TAG}.tgz`,
    `opencode-windows-x64-baseline-${TAG}.tgz`,
];

function testPackageBase(): void {
    assert.equal(opencodeNativePackageBase("darwin", "arm64"), "opencode-darwin-arm64");
    assert.equal(opencodeNativePackageBase("linux", "x64"), "opencode-linux-x64");
    // process.platform "win32" maps to the "windows" token used in package names.
    assert.equal(opencodeNativePackageBase("win32", "x64"), "opencode-windows-x64");
    // Unknown values pass through unchanged rather than throwing.
    assert.equal(opencodeNativePackageBase("freebsd", "ppc64"), "opencode-freebsd-ppc64");
}

function testBinaryName(): void {
    assert.equal(opencodeBinaryName("darwin"), "opencode");
    assert.equal(opencodeBinaryName("linux"), "opencode");
    assert.equal(opencodeBinaryName("win32"), "opencode.exe");
}

function testSelectMacAndWindows(): void {
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "darwin", rawArch: "arm64", tarballNames: FULL_MATRIX, isMusl: false }),
        `opencode-darwin-arm64-${TAG}.tgz`,
    );
    // x64 with a baseline variant present: the non-baseline (AVX2) build wins.
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "darwin", rawArch: "x64", tarballNames: FULL_MATRIX, isMusl: false }),
        `opencode-darwin-x64-${TAG}.tgz`,
    );
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "win32", rawArch: "x64", tarballNames: FULL_MATRIX, isMusl: false }),
        `opencode-windows-x64-${TAG}.tgz`,
    );
}

function testSelectLinuxMuslPreference(): void {
    // glibc host: plain build chosen over baseline / musl variants.
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "linux", rawArch: "x64", tarballNames: FULL_MATRIX, isMusl: false }),
        `opencode-linux-x64-${TAG}.tgz`,
    );
    // musl host (Alpine): the musl build is required and must win.
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "linux", rawArch: "x64", tarballNames: FULL_MATRIX, isMusl: true }),
        `opencode-linux-x64-musl-${TAG}.tgz`,
    );
    // musl host, arm64: only plain + musl exist; musl wins.
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "linux", rawArch: "arm64", tarballNames: FULL_MATRIX, isMusl: true }),
        `opencode-linux-arm64-musl-${TAG}.tgz`,
    );
}

function testSelectNoFalseArchMatch(): void {
    // arch "arm" must NOT grab an "arm64" tarball (the trailing dash guards this).
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "linux", rawArch: "arm", tarballNames: FULL_MATRIX, isMusl: false }),
        null,
    );
}

function testSelectNoMatch(): void {
    // Empty list.
    assert.equal(
        selectOpencodeNativeTarball({ rawPlatform: "darwin", rawArch: "arm64", tarballNames: [], isMusl: false }),
        null,
    );
    // Only unrelated entries (other platforms / non-tarballs): no match for darwin/arm64.
    assert.equal(
        selectOpencodeNativeTarball({
            rawPlatform: "darwin",
            rawArch: "arm64",
            tarballNames: ["opencode-linux-x64-1.tgz", "opencode-darwin-arm64.txt", "package.json", "README.md"],
            isMusl: false,
        }),
        null,
    );
}

function testCachePaths(): void {
    const mac = opencodeBinaryCachePaths({
        homeDir: "/home/me",
        tarball: `opencode-darwin-arm64-${TAG}.tgz`,
        binaryName: "opencode",
    });
    assert.equal(mac.cacheDir, path.join("/home/me", ".cache", "opencode-ai", `opencode-darwin-arm64-${TAG}`));
    assert.equal(mac.cacheBinDir, path.join(mac.cacheDir, "bin"));
    assert.equal(mac.binaryPath, path.join(mac.cacheDir, "bin", "opencode"));
    // The binary always lives directly under the cache bin dir — that directory is
    // what gets prepended to PATH, so binaryPath's dirname must equal cacheBinDir.
    assert.equal(path.dirname(mac.binaryPath), mac.cacheBinDir);

    // Windows: .exe name and tarball basename stripped of .tgz.
    const win = opencodeBinaryCachePaths({
        homeDir: "/home/me",
        tarball: `opencode-windows-x64-${TAG}.tgz`,
        binaryName: "opencode.exe",
    });
    assert.equal(win.binaryPath, path.join("/home/me", ".cache", "opencode-ai", `opencode-windows-x64-${TAG}`, "bin", "opencode.exe"));
}

function main(): void {
    testPackageBase();
    testBinaryName();
    testSelectMacAndWindows();
    testSelectLinuxMuslPreference();
    testSelectNoFalseArchMatch();
    testSelectNoMatch();
    testCachePaths();
    console.log("opencode-bin tests passed");
}

main();
