import path from "path";

// Node's `process.platform` / `process.arch` values mapped to the tokens used in
// the opencode native package names (`opencode-<platform>-<arch>`).
const PLATFORM_MAP: Record<string, string> = { darwin: "darwin", linux: "linux", win32: "windows" };
const ARCH_MAP: Record<string, string> = { x64: "x64", arm64: "arm64", arm: "arm" };

// Prefix of the native package/tarball name for the given platform+arch, e.g.
// `opencode-darwin-arm64`. Unknown values pass through unchanged so a future
// platform still produces a deterministic (if unmatched) base.
export function opencodeNativePackageBase(rawPlatform: string, rawArch: string): string {
    const platform = PLATFORM_MAP[rawPlatform] ?? rawPlatform;
    const arch = ARCH_MAP[rawArch] ?? rawArch;
    return `opencode-${platform}-${arch}`;
}

// Name of the executable inside the native package for the given platform.
export function opencodeBinaryName(rawPlatform: string): string {
    const platform = PLATFORM_MAP[rawPlatform] ?? rawPlatform;
    return platform === "windows" ? "opencode.exe" : "opencode";
}

// Pick the native tarball matching the current platform/arch from a list of
// embedded tarball file names. Variants are ranked so the right build wins:
// the musl/glibc flavour matching the host, and the non-baseline (AVX2) build
// when present. Returns null when no tarball matches the platform.
export function selectOpencodeNativeTarball(args: {
    rawPlatform: string;
    rawArch: string;
    tarballNames: string[];
    isMusl: boolean;
}): string | null {
    const base = opencodeNativePackageBase(args.rawPlatform, args.rawArch);
    // The trailing `-` ensures `opencode-linux-arm` does not match `...-arm64-...`.
    const matches = args.tarballNames.filter(
        (name) => name.startsWith(`${base}-`) && name.endsWith(".tgz"),
    );
    if (matches.length === 0) {
        return null;
    }
    const score = (name: string): number =>
        (name.includes("-musl-") === args.isMusl ? 2 : 0) + (name.includes("-baseline-") ? 0 : 1);
    return [...matches].sort((a, b) => score(b) - score(a))[0];
}

// Cache layout used by the opencode launcher: the native tarball is extracted to
// `<home>/.cache/opencode-ai/<tarball-basename>/`, with the executable under
// `bin/`. We mirror it so we reuse (or populate) the same location.
export function opencodeBinaryCachePaths(args: {
    homeDir: string;
    tarball: string;
    binaryName: string;
}): { cacheDir: string; cacheBinDir: string; binaryPath: string } {
    const cacheDir = path.join(args.homeDir, ".cache", "opencode-ai", path.basename(args.tarball, ".tgz"));
    const cacheBinDir = path.join(cacheDir, "bin");
    return { cacheDir, cacheBinDir, binaryPath: path.join(cacheBinDir, args.binaryName) };
}
