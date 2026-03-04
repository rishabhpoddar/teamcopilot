import { AxiosError } from "axios";

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
        };
    }
    if (typeof err === "string") {
        err = {
            message: err
        };
    }
    const status = err.status || 500;
    let message = err.message || "Unknown error";
    if (typeof message !== "string") {
        message = JSON.stringify(message);
    }
    const ourCodeStack = new Error("Our code stack").stack;
    const meta = { status, stack: err.stack, ourCodeStack, apiPath, apiMethod, ...customMeta };
    console.error(message, meta);
}
