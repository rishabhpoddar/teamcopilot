import assert from "node:assert/strict";
import {
    extractReferencedSkillSecrets,
    extractReferencedWorkflowSecrets,
    parseSkillRequiredSecrets,
    parseWorkflowRequiredSecrets,
    validateSkillSecretContract,
    validateWorkflowSecretContract,
} from "../src/utils/secret-contract-validation";

function assertThrowsMessage(fn: () => void, expectedMessage: string): void {
    let thrown: unknown;
    try {
        fn();
    } catch (error) {
        thrown = error;
    }

    assert.ok(thrown && typeof thrown === "object" && "message" in thrown, "Expected function to throw an object with a message");
    assert.equal((thrown as { message: string }).message, expectedMessage);
}

function runExtractReferenceTests(): void {
    assert.deepEqual(
        extractReferencedWorkflowSecrets([
            "import os",
            "api_key = os.environ['OPENAI_API_KEY']",
            "gh = os.getenv(\"GITHUB_TOKEN\")",
            "other = environ.get('slack_bot_token')",
        ].join("\n")),
        ["GITHUB_TOKEN", "OPENAI_API_KEY", "SLACK_BOT_TOKEN"],
    );

    assert.deepEqual(
        extractReferencedSkillSecrets([
            "Use {{SECRET:OPENAI_API_KEY}} for the request.",
            "Then use {{SECRET:GITHUB_TOKEN}} for GitHub.",
            "Repeat {{SECRET:OPENAI_API_KEY}} if needed.",
        ].join("\n")),
        ["GITHUB_TOKEN", "OPENAI_API_KEY"],
    );
}

function runWorkflowDeclarationTests(): void {
    assert.deepEqual(
        parseWorkflowRequiredSecrets(JSON.stringify({
            required_secrets: ["openai_api_key", "GITHUB_TOKEN"]
        })),
        ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    );

    assertThrowsMessage(
        () => parseWorkflowRequiredSecrets(JSON.stringify({
            required_secrets: ["OPENAI_API_KEY", "openai_api_key"]
        })),
        "workflow.json required_secrets contains duplicate required secret keys: OPENAI_API_KEY",
    );

    assertThrowsMessage(
        () => parseWorkflowRequiredSecrets("{invalid json"),
        "workflow.json must contain valid JSON",
    );

    validateWorkflowSecretContract({
        workflowJsonContent: JSON.stringify({
            intent_summary: "demo",
            inputs: {},
            required_secrets: ["OPENAI_API_KEY", "GITHUB_TOKEN"],
            triggers: { manual: true },
            runtime: { timeout_seconds: 10 },
        }),
        runPyContent: [
            "import os",
            "api_key = os.environ['OPENAI_API_KEY']",
            "gh = os.getenv('GITHUB_TOKEN')",
        ].join("\n"),
    });

    assertThrowsMessage(
        () => validateWorkflowSecretContract({
            workflowJsonContent: JSON.stringify({
                intent_summary: "demo",
                inputs: {},
                required_secrets: ["OPENAI_API_KEY"],
                triggers: { manual: true },
                runtime: { timeout_seconds: 10 },
            }),
            runPyContent: [
                "import os",
                "api_key = os.environ['OPENAI_API_KEY']",
                "gh = os.getenv('GITHUB_TOKEN')",
            ].join("\n"),
        }),
        "run.py references secret keys not declared in workflow.json required_secrets: GITHUB_TOKEN",
    );
}

function runSkillDeclarationTests(): void {
    assert.deepEqual(
        parseSkillRequiredSecrets([
            "---",
            "name: demo-skill",
            "required_secrets:",
            "  - openai_api_key",
            "  - GITHUB_TOKEN",
            "---",
            "",
            "Use {{SECRET:OPENAI_API_KEY}}.",
        ].join("\n")),
        ["OPENAI_API_KEY", "GITHUB_TOKEN"],
    );

    assertThrowsMessage(
        () => parseSkillRequiredSecrets([
            "---",
            "name: demo-skill",
            "required_secrets: [\"OPENAI_API_KEY\", \"openai_api_key\"]",
            "---",
        ].join("\n")),
        "SKILL.md required_secrets contains duplicate required secret keys: OPENAI_API_KEY",
    );

    assertThrowsMessage(
        () => parseSkillRequiredSecrets([
            "---",
            "name: demo-skill",
            "required_secrets: [OPENAI_API_KEY, GITHUB_TOKEN]",
            "---",
        ].join("\n")),
        "SKILL.md frontmatter required_secrets must be a valid string array",
    );

    validateSkillSecretContract([
        "---",
        "name: demo-skill",
        "required_secrets:",
        "  - OPENAI_API_KEY",
        "  - GITHUB_TOKEN",
        "---",
        "",
        "Use {{SECRET:OPENAI_API_KEY}} and {{SECRET:GITHUB_TOKEN}}.",
    ].join("\n"));

    validateSkillSecretContract([
        "---",
        "name: demo-skill",
        "required_secrets: []",
        "---",
        "",
        "No secrets are used here.",
    ].join("\n"));

    validateSkillSecretContract([
        "---",
        "name: demo-skill",
        "required_secrets:",
        "  - OPENAI_API_KEY",
        "  - GITHUB_TOKEN",
        "---",
        "",
        "This skill does not currently use the declared placeholders yet.",
    ].join("\n"));

    validateSkillSecretContract([
        "---",
        "name: demo-skill",
        "required_secrets:",
        "  - openai_api_key",
        "---",
        "",
        "Use {{SECRET:OPENAI_API_KEY}}.",
    ].join("\n"));

    validateSkillSecretContract([
        "---",
        "name: demo-skill",
        "required_secrets:",
        "  - OPENAI_API_KEY",
        "---",
        "",
        "Use {{SECRET:OPENAI_API_KEY}} twice: {{SECRET:OPENAI_API_KEY}}.",
    ].join("\n"));

    validateSkillSecretContract([
        "---",
        "name: demo-skill",
        "required_secrets:",
        "  - OPENAI_API_KEY",
        "---",
        "",
        "## Instructions",
        "",
        "Call the service with {{SECRET:OPENAI_API_KEY}}.",
    ].join("\n"));

    assertThrowsMessage(
        () => validateSkillSecretContract([
            "---",
            "name: demo-skill",
            "required_secrets:",
            "  - OPENAI_API_KEY",
            "---",
            "",
            "Use {{SECRET:OPENAI_API_KEY}} and {{SECRET:GITHUB_TOKEN}}.",
        ].join("\n")),
        "SKILL.md uses secret placeholders not declared in required_secrets: GITHUB_TOKEN",
    );

    assertThrowsMessage(
        () => validateSkillSecretContract([
            "---",
            "name: demo-skill",
            "required_secrets: []",
            "---",
            "",
            "Use {{SECRET:OPENAI_API_KEY}}.",
        ].join("\n")),
        "SKILL.md uses secret placeholders not declared in required_secrets: OPENAI_API_KEY",
    );

    assertThrowsMessage(
        () => validateSkillSecretContract([
            "---",
            "name: demo-skill",
            "required_secrets:",
            "  - OPENAI_API_KEY",
            "---",
            "",
            "Use {{SECRET:GITHUB_TOKEN}} and {{SECRET:SLACK_BOT_TOKEN}}.",
        ].join("\n")),
        "SKILL.md uses secret placeholders not declared in required_secrets: GITHUB_TOKEN, SLACK_BOT_TOKEN",
    );
}

function run(): void {
    runExtractReferenceTests();
    runWorkflowDeclarationTests();
    runSkillDeclarationTests();
    console.log("Secret contract validation tests passed");
}

run();
