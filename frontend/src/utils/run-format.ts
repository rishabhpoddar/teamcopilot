import type { WorkflowRun } from '../types/workflow';

export function formatWorkflowRunRunner(
    run: WorkflowRun,
    options: { includeEmailForUserRuns?: boolean } = {}
): string {
    const includeEmailForUserRuns = options.includeEmailForUserRuns === true;
    if (run.run_source === 'cronjob') {
        return run.user ? `Cronjob (${run.user.name})` : 'Cronjob';
    }
    if (run.user) {
        return includeEmailForUserRuns ? `${run.user.name} (${run.user.email})` : run.user.name;
    }
    if (run.run_source === 'api') {
        return 'Workflow API';
    }
    return 'Unknown';
}
