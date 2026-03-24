import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createResourceFileManager } from "../src/utils/resource-files";
import { sanitizeForClient, sanitizeStringContent } from "../src/utils/redact";

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
        const effectiveVisibleContent = testCase.resourceLabel === "skill"
            ? sanitizeForClient({ content: readResult.content }).content
            : readResult.content;
        const expectedVisibleContent = testCase.expectedVisibleContent ?? (
            testCase.resourceLabel === "skill"
                ? sanitizeForClient({ content: testCase.rawContent }).content
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

function assertSkillReadIsRedacted(): void {
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
        assert.equal(readResult.content, rawContent, "Skill file manager should return raw content before API sanitization.");
        assert.equal(
            sanitizeForClient({ content: readResult.content }).content,
            sanitizeForClient({ content: rawContent }).content,
            "Skill file reads should use the shared response redaction behavior after API sanitization."
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
}

function runSaveRoundTripCases(): void {
    const cases: SaveRoundTripCase[] = [
        {
            name: "skill save preserves unchanged masked secret while updating plain text",
            resourceLabel: "skill",
            filePath: "SKILL.md",
            rawContent: [
                "# Example Skill",
                "",
                "- **secret**: sk-1234567890abcdef # keep available",
                "Keep this instructional text intact.",
                "",
            ].join("\n"),
            edit: (visible) => visible
                .replace("Keep this instructional text intact.", "Keep this instructional text updated.")
                .replace("# keep available", "# keep available for operators"),
            expectedPersistedContent: [
                "# Example Skill",
                "",
                "- **secret**: sk-1234567890abcdef # keep available for operators",
                "Keep this instructional text updated.",
                "",
            ].join("\n"),
        },
        {
            name: "skill save fully replaces a masked secret with a new literal value",
            resourceLabel: "skill",
            filePath: "SKILL.md",
            rawContent: "- **secret**: sk-1234567890abcdef\n",
            edit: (visible) => visible.replace("***def", "totally-new-secret"),
            expectedPersistedContent: "- **secret**: totally-new-secret\n",
        },
        {
            name: "skill save partial masked edit splices the new suffix into the old raw secret",
            resourceLabel: "skill",
            filePath: "SKILL.md",
            rawContent: "- **secret**: sk-1234567890abcdef\n",
            edit: (visible) => visible.replace("***def", "***xyz"),
            expectedPersistedContent: "- **secret**: sk-1234567890abcxyz\n",
        },
        {
            name: "skill save supports deleting a line adjacent to a masked secret",
            resourceLabel: "skill",
            filePath: "SKILL.md",
            rawContent: [
                "# Title",
                "- **secret**: sk-1234567890abcdef",
                "Remove this line",
                "",
            ].join("\n"),
            edit: (visible) => visible.replace("Remove this line\n", ""),
            expectedPersistedContent: [
                "# Title",
                "- **secret**: sk-1234567890abcdef",
                "",
            ].join("\n"),
        },
        {
            name: "skill save supports inserting text around a masked secret",
            resourceLabel: "skill",
            filePath: "SKILL.md",
            rawContent: [
                "# Title",
                "- **secret**: sk-1234567890abcdef",
                "",
            ].join("\n"),
            edit: (visible) => visible.replace("# Title", "# Title\nInserted guidance"),
            expectedPersistedContent: [
                "# Title",
                "Inserted guidance",
                "- **secret**: sk-1234567890abcdef",
                "",
            ].join("\n"),
        },
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
        {
            name: "skill nested file remains redacted and saves correctly",
            resourceLabel: "skill",
            filePath: "docs/guide.md",
            rawContent: "Authorization: Bearer myverylongtokensecretvalue\n",
            edit: (visible) => visible.replace("***lue", "***XYZ"),
            expectedPersistedContent: "Authorization: Bearer myveryXYZ\n",
        },
    ];

    for (const testCase of cases) {
        runSaveRoundTrip(testCase);
    }
}

function main(): void {
    assertSkillReadIsRedacted();
    runSaveRoundTripCases();
    console.log("Redacted file save tests passed");
}

main();
