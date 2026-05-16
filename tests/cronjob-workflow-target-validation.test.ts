import assert from "node:assert/strict";

async function main(): Promise<void> {
    const workflowValidationModule = require("../src/utils/workflow-run-validation") as typeof import("../src/utils/workflow-run-validation");
    const checked: Array<{ slug: string; userId: string }> = [];
    (workflowValidationModule as unknown as {
        assertUserCanRunWorkflow: (slug: string, userId: string) => Promise<void>;
    }).assertUserCanRunWorkflow = async (slug: string, userId: string) => {
        checked.push({ slug, userId });
    };

    const { validateCronjobTarget } = require("../src/cronjobs/scheduler") as typeof import("../src/cronjobs/scheduler");

    const defaultInputs = await validateCronjobTarget({
        target_type: "workflow",
        workflow_slug: "  daily-report  ",
    }, "user-1");
    assert.deepEqual(defaultInputs, {
        targetType: "workflow",
        prompt: null,
        promptAllowWorkflowRunsWithoutPermission: null,
        workflowSlug: "daily-report",
        workflowInputJson: "{}",
    });
    assert.deepEqual(checked[0], { slug: "daily-report", userId: "user-1" });

    const explicitInputs = await validateCronjobTarget({
        target_type: "workflow",
        prompt: "should be ignored",
        allow_workflow_runs_without_permission: false,
        workflow_slug: "daily-report",
        workflow_inputs: {
            topic: "usage",
            dry_run: true,
        },
    }, "user-2");
    assert.deepEqual(explicitInputs, {
        targetType: "workflow",
        prompt: null,
        promptAllowWorkflowRunsWithoutPermission: null,
        workflowSlug: "daily-report",
        workflowInputJson: JSON.stringify({ topic: "usage", dry_run: true }),
    });
    assert.deepEqual(checked[1], { slug: "daily-report", userId: "user-2" });

    await assert.rejects(
        () => validateCronjobTarget({
            target_type: "workflow",
            workflow_slug: "daily-report",
            workflow_inputs: [],
        }, "user-3"),
        (err: unknown) => {
            assert.equal((err as { status?: number }).status, 400);
            assert.equal((err as { message?: string }).message, "workflow_inputs must be an object");
            return true;
        },
    );

    await assert.rejects(
        () => validateCronjobTarget({
            target_type: "workflow",
            workflow_slug: "   ",
            workflow_inputs: {},
        }, "user-4"),
        (err: unknown) => {
            assert.equal((err as { status?: number }).status, 400);
            assert.equal((err as { message?: string }).message, "workflow_slug is required");
            return true;
        },
    );

    console.log("Cronjob workflow target validation tests passed");
}

void main();
