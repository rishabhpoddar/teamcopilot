import { CronJob } from "cron";
import { reconcileResourceMetadataWithFilesystem } from "./resource-reconciliation";
import { startUserCronjobScheduler } from "../cronjobs/scheduler";

let isCronStarted = false;

export function startCronJobs() {
    if (isCronStarted) {
        return;
    }
    isCronStarted = true;

    const resourceReconciliationJob = new CronJob("0 * * * * *", () => {
        void reconcileResourceMetadataWithFilesystem();
    });
    resourceReconciliationJob.start();

    void startUserCronjobScheduler();
}
