import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { createResourceFileManager } from "../src/utils/resource-files";
import { sanitizeForClient, sanitizeStringContent } from "../src/utils/redact";

function assertSkillsRouterKeepsRawFileContent(): void {
    const skillsRouterSource = fs.readFileSync(
        path.resolve(__dirname, "../src/skills/index.ts"),
        "utf-8"
    );
    assert.ok(
        skillsRouterSource.includes("skipResponseSanitizationForFileContentRead: false"),
        "Skills file-content reads must stay sanitized for the frontend."
    );
}

function main(): void {
    assertSkillsRouterKeepsRawFileContent();

    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "teamcopilot-skill-editor-"));
    try {
        const skillRoot = path.join(tempRoot, "example-skill");
        fs.mkdirSync(skillRoot, { recursive: true });

        const skillPath = path.join(skillRoot, "SKILL.md");
        const originalContent = [
            "# Example Skill",
            "",
            "## Required Secrets",
            "- **secret**: sk-1234567890abcdef # keep available",
            "",
            "Keep this instructional text intact.",
            "",
        ].join("\n");
        fs.writeFileSync(skillPath, originalContent, "utf-8");

        const skillManager = createResourceFileManager({
            getResourcePath: () => skillRoot,
            resourceLabel: "skill",
            editorLabel: "Skill",
        });

        const readResponse = skillManager.readFileContent("ignored", "SKILL.md");
        assert.equal(readResponse.kind, "text");

        const sanitizedEditorContent = sanitizeForClient(readResponse).content;
        assert.notEqual(
            sanitizedEditorContent,
            originalContent,
            "Skill editor repro failed: sanitized response should differ from on-disk SKILL.md content."
        );
        assert.match(
            sanitizedEditorContent,
            /\*\*\*[A-Za-z0-9]+/,
            "Skill editor repro failed: expected sanitized editor content to contain a masked secret."
        );

        const editedSkillContent = sanitizedEditorContent.replace(
            "Keep this instructional text intact.",
            "Keep this instructional text updated."
        ).replace(
            "# keep available",
            "# keep available for operators"
        );

        skillManager.saveFileContent("ignored", {
            path: "SKILL.md",
            content: editedSkillContent,
            base_etag: readResponse.etag,
        });

        const persistedSkillContent = fs.readFileSync(skillPath, "utf-8");
        assert.match(
            persistedSkillContent,
            /sk-1234567890abcdef/,
            "Skill editor save should preserve the original raw secret value on disk."
        );
        assert.match(
            persistedSkillContent,
            /# keep available for operators/,
            "Skill editor save should still apply edits on the same line as a masked secret."
        );
        assert.match(
            persistedSkillContent,
            /Keep this instructional text updated\./,
            "Skill editor save should still persist non-secret edits."
        );

        const workflowRoot = path.join(tempRoot, "example-workflow");
        fs.mkdirSync(workflowRoot, { recursive: true });
        const dotenvPath = path.join(workflowRoot, ".env");
        const originalDotenv = [
            "API_KEY=abcdef123456",
            "NORMAL=value",
            "",
        ].join("\n");
        fs.writeFileSync(dotenvPath, originalDotenv, "utf-8");

        const workflowManager = createResourceFileManager({
            getResourcePath: () => workflowRoot,
            resourceLabel: "workflow",
            editorLabel: "Workflow",
        });

        const dotenvRead = workflowManager.readFileContent("ignored", ".env");
        assert.equal(dotenvRead.kind, "text");
        const sanitizedDotenv = dotenvRead.content;
        assert.equal(
            sanitizedDotenv,
            sanitizeStringContent(originalDotenv),
            "Workflow .env reads should use the shared redaction logic."
        );

        const editedDotenv = sanitizedDotenv.replace("NORMAL=value", "NORMAL=updated");
        workflowManager.saveFileContent("ignored", {
            path: ".env",
            content: editedDotenv,
            base_etag: dotenvRead.etag,
        });

        const persistedDotenv = fs.readFileSync(dotenvPath, "utf-8");
        assert.match(
            persistedDotenv,
            /API_KEY=abcdef123456/,
            "Workflow .env save should preserve the original raw secret value on disk."
        );
        assert.match(
            persistedDotenv,
            /NORMAL=updated/,
            "Workflow .env save should still persist non-secret edits."
        );
    } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    console.log("Skill editor redaction roundtrip test passed");
}

main();
