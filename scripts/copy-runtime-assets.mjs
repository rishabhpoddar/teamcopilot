import fs from "fs";
import path from "path";

const projectRoot = process.cwd();
const workspaceSourceDirectory = path.join(projectRoot, "src", "workspace_files");
const workspaceTargetDirectory = path.join(projectRoot, "dist", "workspace_files");
const frontendSourceDirectory = path.join(projectRoot, "frontend", "dist");
const frontendTargetDirectory = path.join(projectRoot, "dist", "frontend");
const skippedPathSegments = new Set([
    ".env",
    ".sqlite",
    ".venv",
    "node_modules",
    "workflows",
    "workflow-runs",
]);

if (!fs.existsSync(workspaceSourceDirectory)) {
    throw new Error(`Missing runtime asset source directory: ${workspaceSourceDirectory}`);
}

if (!fs.existsSync(frontendSourceDirectory)) {
    throw new Error(`Missing frontend build directory: ${frontendSourceDirectory}`);
}

fs.rmSync(workspaceTargetDirectory, { recursive: true, force: true });
fs.cpSync(workspaceSourceDirectory, workspaceTargetDirectory, {
    recursive: true,
    filter: (sourcePath) => {
        const relativePath = path.relative(workspaceSourceDirectory, sourcePath);
        if (!relativePath || relativePath === ".") {
            return true;
        }

        const segments = relativePath.split(path.sep);
        if (segments.some((segment) => skippedPathSegments.has(segment))) {
            return false;
        }

        if (segments[0] === ".agents" && segments[1] === "skills") {
            return false;
        }

        if (segments[0] === ".opencode" && segments[1] === "xdg-data") {
            return false;
        }

        return true;
    },
});

fs.rmSync(frontendTargetDirectory, { recursive: true, force: true });
fs.cpSync(frontendSourceDirectory, frontendTargetDirectory, { recursive: true });
