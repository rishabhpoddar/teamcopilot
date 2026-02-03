import cron from 'node-cron';
import { logError, logInfo } from '../logging';

export function startCronJobs() {

    async function cronWrapper(funName: string, f: () => Promise<void>) {
        try {
            logInfo(`Starting cron job: ${funName}`, {
            });
            await f();
            logInfo(`Cron job: ${funName} completed!`, {
            });
        } catch (error) {
            logError({ err: error });
            logError({ err: `Cron job: ${funName} failed!` });
        }
    }
}