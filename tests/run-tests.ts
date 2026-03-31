import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";

const testsRoot = path.resolve(__dirname);

function collectTestFiles(dir: string): string[] {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const files: string[] = [];

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...collectTestFiles(fullPath));
            continue;
        }
        if (entry.isFile() && entry.name.endsWith(".test.ts")) {
            files.push(fullPath);
        }
    }

    return files;
}

function main(): void {
    const testFiles = collectTestFiles(testsRoot).sort();
    if (testFiles.length === 0) {
        console.log("No test files found.");
        return;
    }

    let hasFailures = false;
    for (const [index, testFile] of testFiles.entries()) {
        const relativePath = path.relative(process.cwd(), testFile);
        console.log(`[${index + 1}/${testFiles.length}] Running ${relativePath}`);
        const result = spawnSync(process.execPath, ["-r", "ts-node/register", testFile], {
            stdio: "inherit",
        });
        if (result.status !== 0) {
            hasFailures = true;
            console.error(`FAILED: ${relativePath}`);
            break;
        }
        console.log(`PASSED: ${relativePath}`);
    }

    if (hasFailures) {
        process.exit(1);
    }

    console.log(`All test files passed: ${testFiles.length}`);
}

main();
