import assert from "node:assert/strict";
import {
    parsePromptCronjobTaskAndInitialTodos,
    validateCronjobSchedule,
    validateCronjobTarget,
} from "../src/cronjobs/scheduler";
import { buildCurrentTimePrompt } from "../src/utils/chat-prompt-context";

function buildCronjobPromptWithExecutionSteps(prompt: string, executionSteps: string[]): string {
    const promptText = prompt.trim();
    const steps = executionSteps.map((step) => step.trim()).filter((step) => step.length > 0);

    if (steps.length === 0) {
        return promptText;
    }

    const promptSuffix = /[.?!]$/.test(promptText) ? '' : '.';
    return `${promptText}${promptSuffix} Todo steps to follow:\n- ${steps.join('\n- ')}`;
}

async function main(): Promise<void> {
    assert.deepEqual(
        parsePromptCronjobTaskAndInitialTodos("Check repo health."),
        {
            prompt: "Check repo health.",
            initialTodos: [],
        },
        "prompt parsing should leave prompts without saved todos unchanged",
    );

    assert.deepEqual(
        parsePromptCronjobTaskAndInitialTodos([
            "Check repo health. Todo steps to follow:",
            "- Inspect git status",
            "- Run tests",
            "- Summarize failures",
        ].join("\n")),
        {
            prompt: "Check repo health.",
            initialTodos: [
                "Inspect git status",
                "Run tests",
                "Summarize failures",
            ],
        },
        "prompt parsing should extract saved todo steps from the legacy prompt marker",
    );

    assert.deepEqual(
        parsePromptCronjobTaskAndInitialTodos([
            "Check repo health.",
            "",
            "Todo steps to follow:",
            "Inspect git status",
            "- Run tests",
            "",
            "- Summarize failures",
        ].join("\n")),
        {
            prompt: "Check repo health.",
            initialTodos: [
                "Inspect git status",
                "Run tests",
                "Summarize failures",
            ],
        },
        "prompt parsing should accept saved todo lines with or without dash prefixes",
    );

    assert.deepEqual(
        parsePromptCronjobTaskAndInitialTodos("Check repo health. Todo steps to follow:\n\n"),
        {
            prompt: "Check repo health.",
            initialTodos: [],
        },
        "prompt parsing should tolerate an empty saved todo section",
    );

    assert.equal(
        buildCronjobPromptWithExecutionSteps("Check repo health", [
            "Inspect git status",
            "Run relevant tests",
            "Summarize failures",
        ]),
        [
            "Check repo health. Todo steps to follow:",
            "- Inspect git status",
            "- Run relevant tests",
            "- Summarize failures",
        ].join("\n"),
        "prompt serialization should keep execution steps in the order they were provided",
    );

    const fixedDate = new Date("2026-05-12T10:30:45.000Z");
    const timePrompt = buildCurrentTimePrompt(fixedDate);
    assert.ok(timePrompt.includes("# Current time"));
    assert.ok(timePrompt.includes("Current timezone:"));
    assert.ok(timePrompt.includes("Current UTC time: 2026-05-12T10:30:45.000Z"));

    assert.deepEqual(
        validateCronjobSchedule({
            cron_expression: " 0 9 * * 1-5 ",
            timezone: " UTC ",
        }),
        {
            cronExpression: "0 9 * * 1-5",
            timezone: "UTC",
        },
        "validateCronjobSchedule should trim cron expressions and timezones",
    );

    assert.deepEqual(
        validateCronjobSchedule({
            cron_expression: "30 0 9 * * 1-5",
            timezone: "Asia/Kolkata",
        }),
        {
            cronExpression: "30 0 9 * * 1-5",
            timezone: "Asia/Kolkata",
        },
        "validateCronjobSchedule should accept six-field cron expressions",
    );

    assert.throws(
        () => validateCronjobSchedule({ cron_expression: "0 9 * * *", timezone: "Not/AZone" }),
        (err: unknown) => {
            assert.equal((err as { status?: number }).status, 400);
            assert.equal((err as { message?: string }).message, "timezone must be a valid IANA timezone");
            return true;
        },
    );

    assert.throws(
        () => validateCronjobSchedule({ cron_expression: "0 9 *", timezone: "UTC" }),
        (err: unknown) => {
            assert.equal((err as { status?: number }).status, 400);
            assert.equal((err as { message?: string }).message, "cron_expression must have 5 or 6 fields");
            return true;
        },
    );

    assert.deepEqual(
        await validateCronjobTarget({
            target_type: "prompt",
            prompt: "  Summarize usage.  ",
        }, "user-id-not-used-for-prompt"),
        {
            targetType: "prompt",
            prompt: "Summarize usage.",
            promptAllowWorkflowRunsWithoutPermission: true,
            workflowSlug: null,
            workflowInputJson: null,
        },
        "prompt cronjob targets should trim prompts and default workflow permission bypass to true",
    );

    assert.deepEqual(
        await validateCronjobTarget({
            target_type: "prompt",
            prompt: "Ask before workflows",
            allow_workflow_runs_without_permission: false,
        }, "user-id-not-used-for-prompt"),
        {
            targetType: "prompt",
            prompt: "Ask before workflows",
            promptAllowWorkflowRunsWithoutPermission: false,
            workflowSlug: null,
            workflowInputJson: null,
        },
        "prompt cronjob targets should preserve explicit workflow permission mode",
    );

    await assert.rejects(
        () => validateCronjobTarget({
            target_type: "prompt",
            prompt: "   ",
        }, "user-id-not-used-for-prompt"),
        (err: unknown) => {
            assert.equal((err as { status?: number }).status, 400);
            assert.equal((err as { message?: string }).message, "prompt is required");
            return true;
        },
    );

    await assert.rejects(
        () => validateCronjobTarget({
            target_type: "unsupported",
            prompt: "Nope",
        }, "user-id-not-used-for-prompt"),
        (err: unknown) => {
            assert.equal((err as { status?: number }).status, 400);
            assert.equal((err as { message?: string }).message, "target_type must be prompt or workflow");
            return true;
        },
    );

    console.log("Cronjob core tests passed");
}

void main();
