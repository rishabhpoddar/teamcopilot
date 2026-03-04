import { CronJob } from "cron";
import { reconcileResourceMetadataWithFilesystem } from "./resource-reconciliation";

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
}
