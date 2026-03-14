import fs from "fs";
import path from "path";

function findPackageRoot(startDirectory: string): string {
    let currentDirectory = startDirectory;

    while (true) {
        const packageJsonPath = path.join(currentDirectory, "package.json");
        if (fs.existsSync(packageJsonPath)) {
            return currentDirectory;
        }

        const parentDirectory = path.dirname(currentDirectory);
        if (parentDirectory === currentDirectory) {
            throw new Error(`Could not find package.json above ${startDirectory}`);
        }
        currentDirectory = parentDirectory;
    }
}

export function getPackageRoot(): string {
    return findPackageRoot(__dirname);
}

export function getWorkspaceTemplateDirectory(): string {
    const packageRoot = getPackageRoot();
    const candidateDirectories = [
        path.join(packageRoot, "dist", "workspace_files"),
        path.join(packageRoot, "src", "workspace_files"),
    ];

    for (const candidateDirectory of candidateDirectories) {
        if (fs.existsSync(candidateDirectory)) {
            return candidateDirectory;
        }
    }

    throw new Error(`Workspace template directory not found in ${packageRoot}`);
}

export function getFrontendDistDirectory(): string {
    const packageRoot = getPackageRoot();
    const candidateDirectories = [
        path.join(packageRoot, "dist", "frontend"),
        path.join(packageRoot, "frontend", "dist"),
    ];

    for (const candidateDirectory of candidateDirectories) {
        if (fs.existsSync(candidateDirectory)) {
            return candidateDirectory;
        }
    }

    throw new Error(`Frontend build directory not found in ${packageRoot}`);
}

export function getPrismaSchemaPath(): string {
    const schemaPath = path.join(getPackageRoot(), "prisma", "schema.prisma");
    if (!fs.existsSync(schemaPath)) {
        throw new Error(`Prisma schema not found: ${schemaPath}`);
    }
    return schemaPath;
}
