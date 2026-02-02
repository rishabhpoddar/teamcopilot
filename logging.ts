import logdna from "@logdna/logger";
import { AxiosError } from "axios";

const options = {
    level: 'debug', app: "flowpal-" + process.env.ENV!
}

export function logError({ err, apiPath, apiMethod, customMeta }: { err: any, apiPath?: string, apiMethod?: string, customMeta?: Record<string, any> }) {
    if (err instanceof AxiosError) {
        err = {
            message: JSON.stringify({
                url: err.config?.url,
                method: err.config?.method,
                data: err.response?.data || "Error when querying with axios"
            }),
            status: err.response?.status,
            stack: err.stack
        }
    }
    if (typeof err === "string") {
        err = {
            message: err
        }
    }
    let status = err.status || 500;
    let clientMessage = status === 500 ? 'Internal server error' : (err.message || 'Unknown error');
    let loggingMessage = (err.message || 'Unknown error')
    if (typeof loggingMessage !== "string") {
        loggingMessage = JSON.stringify(loggingMessage);
    }
    let ourCodeStack = new Error("Our code stack").stack;
    logger.error!(loggingMessage, { meta: { status, loggingMessage, clientMessage, stack: err.stack, ourCodeStack, apiPath, apiMethod, ...customMeta } });
    if (process.env["ENV"] === "development") {
        console.error(loggingMessage, { meta: { status, loggingMessage, clientMessage, stack: err.stack, ourCodeStack, apiPath, apiMethod } });
    }
}

export async function logInfo(message: string, meta: any = {}) {
    logger.info!(message, {
        meta
    });
}

const logger = logdna.createLogger(process.env.LOGDNA_KEY!, options)
