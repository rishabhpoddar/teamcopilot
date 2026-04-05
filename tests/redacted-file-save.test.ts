import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createResourceFileManager } from "../src/utils/resource-files";
import { sanitizeStringContent } from "../src/utils/redact";

type SaveRoundTripCase = {
    name: string;
    resourceLabel: "skill" | "workflow";
    filePath: string;
    rawContent: string;
    edit: (visibleContent: string) => string;
    expectedVisibleContent?: string;
    expectedPersistedContent: string;
};

function createManager(root: string, resourceLabel: "skill" | "workflow") {
    return createResourceFileManager({
        getResourcePath: () => root,
        resourceLabel,
        editorLabel: resourceLabel === "skill" ? "Skill" : "Workflow",
    });
}

function readVisibleContent(manager: ReturnType<typeof createManager>, filePath: string): { content: string; etag: string } {
    const response = manager.readFileContent("ignored", filePath);
    assert.equal(response.kind, "text");
    return {
        content: response.content,
        etag: response.etag,
    };
}

function runSaveRoundTrip(testCase: SaveRoundTripCase): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-redacted-save-"));
    try {
        const resourceRoot = path.join(tempRoot, testCase.resourceLabel);
        fs.mkdirSync(resourceRoot, { recursive: true });
        const absoluteFilePath = path.join(resourceRoot, testCase.filePath);
        fs.mkdirSync(path.dirname(absoluteFilePath), { recursive: true });
        fs.writeFileSync(absoluteFilePath, testCase.rawContent, "utf-8");

        const manager = createManager(resourceRoot, testCase.resourceLabel);
        const readResult = readVisibleContent(manager, testCase.filePath);
        const effectiveVisibleContent = readResult.content;
        const expectedVisibleContent = testCase.expectedVisibleContent ?? (
            testCase.resourceLabel === "skill"
                ? testCase.rawContent
                : sanitizeStringContent(testCase.rawContent)
        );

        assert.equal(
            effectiveVisibleContent,
            expectedVisibleContent,
            `Unexpected visible content for case: ${testCase.name}`
        );

        const editedContent = testCase.edit(effectiveVisibleContent);
        manager.saveFileContent("ignored", {
            path: testCase.filePath,
            content: editedContent,
            base_etag: readResult.etag,
        });

        const persistedContent = fs.readFileSync(absoluteFilePath, "utf-8");
        assert.equal(
            persistedContent,
            testCase.expectedPersistedContent,
            `Unexpected persisted content for case: ${testCase.name}`
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function assertSkillReadIsRaw(): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-skill-read-"));
    try {
        const resourceRoot = path.join(tempRoot, "skill");
        fs.mkdirSync(resourceRoot, { recursive: true });
        const skillPath = path.join(resourceRoot, "SKILL.md");
        const rawContent = [
            "# Example Skill",
            "",
            "- **secret**: sk-1234567890abcdef",
            "",
        ].join("\n");
        fs.writeFileSync(skillPath, rawContent, "utf-8");

        const manager = createManager(resourceRoot, "skill");
        const readResult = readVisibleContent(manager, "SKILL.md");
        assert.equal(readResult.content, rawContent, "Skill file manager should return raw content.");
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function assertWorkflowNonDotenvReadIsRaw(): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-workflow-read-"));
    try {
        const resourceRoot = path.join(tempRoot, "workflow");
        fs.mkdirSync(resourceRoot, { recursive: true });

        const files = [
            {
                filePath: "README.md",
                rawContent: [
                    "# Example Workflow",
                    "",
                    "Authorization: Bearer sk-1234567890abcdef",
                    "",
                ].join("\n"),
            },
            {
                filePath: "run.py",
                rawContent: [
                    "API_KEY = 'sk-1234567890abcdef'",
                    "print(API_KEY)",
                    "",
                ].join("\n"),
            },
        ];

        const manager = createManager(resourceRoot, "workflow");
        for (const file of files) {
            const absolutePath = path.join(resourceRoot, file.filePath);
            fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
            fs.writeFileSync(absolutePath, file.rawContent, "utf-8");

            const readResult = readVisibleContent(manager, file.filePath);
            assert.equal(
                readResult.content,
                file.rawContent,
                `Workflow non-.env file ${file.filePath} should remain raw`,
            );
        }
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function assertWorkflowDotenvReadIsRedacted(): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-workflow-dotenv-read-"));
    try {
        const resourceRoot = path.join(tempRoot, "workflow");
        fs.mkdirSync(resourceRoot, { recursive: true });
        const dotenvPath = path.join(resourceRoot, ".env");
        const rawContent = [
            "API_KEY=abcdef123456",
            "NORMAL=value",
            "",
        ].join("\n");
        fs.writeFileSync(dotenvPath, rawContent, "utf-8");

        const manager = createManager(resourceRoot, "workflow");
        const readResult = readVisibleContent(manager, ".env");
        assert.equal(
            readResult.content,
            sanitizeStringContent(rawContent),
            "Workflow .env reads should still be redacted",
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function assertSkillDotenvReadIsRedacted(): void {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-skill-dotenv-read-"));
    try {
        const resourceRoot = path.join(tempRoot, "skill");
        fs.mkdirSync(resourceRoot, { recursive: true });
        const dotenvPath = path.join(resourceRoot, ".env");
        const rawContent = [
            "API_KEY=abcdef123456",
            "NORMAL=value",
            "",
        ].join("\n");
        fs.writeFileSync(dotenvPath, rawContent, "utf-8");

        const manager = createManager(resourceRoot, "skill");
        const readResult = readVisibleContent(manager, ".env");
        assert.equal(
            readResult.content,
            sanitizeStringContent(rawContent),
            "Skill .env reads should still be redacted",
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runSaveRoundTripCases(): void {
    const cases: SaveRoundTripCase[] = [
        {
            name: "workflow env save preserves unchanged masked secret while updating plain text",
            resourceLabel: "workflow",
            filePath: ".env",
            rawContent: [
                "API_KEY=abcdef123456",
                "NORMAL=value",
                "",
            ].join("\n"),
            edit: (visible) => visible.replace("NORMAL=value", "NORMAL=updated"),
            expectedVisibleContent: sanitizeStringContent([
                "API_KEY=abcdef123456",
                "NORMAL=value",
                "",
            ].join("\n")),
            expectedPersistedContent: [
                "API_KEY=abcdef123456",
                "NORMAL=updated",
                "",
            ].join("\n"),
        },
        {
            name: "workflow env save fully replaces a masked secret with a new literal value",
            resourceLabel: "workflow",
            filePath: ".env",
            rawContent: "TOKEN=abcdef\n",
            edit: (visible) => visible.replace("***def", "uvwxyz"),
            expectedVisibleContent: "TOKEN=***def\n",
            expectedPersistedContent: "TOKEN=uvwxyz\n",
        },
        {
            name: "workflow env save partial masked edit splices the new suffix into the old raw secret",
            resourceLabel: "workflow",
            filePath: ".env",
            rawContent: "TOKEN=abcdef\n",
            edit: (visible) => visible.replace("***def", "***xyz"),
            expectedVisibleContent: "TOKEN=***def\n",
            expectedPersistedContent: "TOKEN=abcxyz\n",
        },
        {
            name: "workflow non-redacted file saves content directly",
            resourceLabel: "workflow",
            filePath: "README.md",
            rawContent: "token=abcdef\n",
            edit: () => "token=replaced-directly\n",
            expectedVisibleContent: "token=abcdef\n",
            expectedPersistedContent: "token=replaced-directly\n",
        },
    ];

    for (const testCase of cases) {
        runSaveRoundTrip(testCase);
    }
}

function main(): void {
    assertSkillReadIsRaw();
    assertSkillDotenvReadIsRedacted();
    assertWorkflowNonDotenvReadIsRaw();
    assertWorkflowDotenvReadIsRedacted();
    runSaveRoundTripCases();
    console.log("Redacted file save tests passed");
}

main();
