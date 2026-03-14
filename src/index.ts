(BigInt.prototype as any).toJSON = function () {
    const num = Number(this);
    if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
        throw new Error(`BigInt ${this} exceeds Number safe range`);
    }
    return num;
};

import dotenv from 'dotenv';
dotenv.config();
import express from "express";
import { logError } from "./logging";
import authRouter from "./auth";
import workflowsRouter from "./workflows";
import chatRouter from "./chat";
import skillsRouter from "./skills";
import usersRouter from "./users";
import { startCronJobs } from "./cronjob";
import { startOpencodeServer, stopOpencodeServer } from "./opencode-server";
import path from 'path';
import { Server } from "http";
import { assertEnv, parseIntStrict } from "./utils/assert";
import { apiHandler } from "./utils";
import { sanitizeForClient, sanitizeStringContent } from "./utils/redact";
import { ensureWorkspaceDatabase, getWorkspaceDirFromEnv, initializeWorkspaceDirectory } from "./utils/workspace-sync";
import { initializeOpencodeAuthStorage } from "./utils/opencode-auth";
import opencodeAuthRouter from "./opencode-auth";
import { loadJwtSecret } from "./utils/jwt-secret";
import { getFrontendDistDirectory } from "./utils/runtime-paths";
const app = express();
const frontendDistDirectory = getFrontendDistDirectory();

app.use(express.json());

// Logging middleware
// app.use((req, res, next) => {
//     const start = Date.now();
//     res.on('finish', async () => {
//         const duration = Date.now() - start;
//         const logData = {
//             method: req.method,
//             path: req.path,
//             statusCode: res.statusCode,
//             duration: `${duration}ms`,
//             userAgent: req.get('user-agent'),
//             ip: req.ip
//         };
//         logInfo(`HTTP Request: ${req.method} ${req.path} ${res.statusCode}`, { meta: logData });
//     });
//     next();
// });

// Mount auth routes directly (no sanitization for token responses)
app.use('/api/auth', authRouter);

const apiRouter = express.Router();

apiRouter.use((_req, res, next) => {
    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);
    const shouldSkipSanitization = () => Boolean((res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization);
    const hasJsonContentType = () => {
        const contentType = res.getHeader("Content-Type");
        if (typeof contentType === "string") {
            return contentType.includes("application/json");
        }
        if (Array.isArray(contentType)) {
            return contentType.some((value) => value.includes("application/json"));
        }
        return false;
    };

    res.json = ((body: unknown) => {
        if (shouldSkipSanitization()) {
            return originalJson(body);
        }
        return originalJson(sanitizeForClient(body));
    }) as typeof res.json;

    res.send = ((body?: unknown) => {
        if (shouldSkipSanitization()) {
            return originalSend(body);
        }
        if (typeof body === "string") {
            if (hasJsonContentType()) {
                return originalSend(body);
            }
            return originalSend(sanitizeStringContent(body));
        }
        if (Buffer.isBuffer(body)) {
            if (hasJsonContentType()) {
                return originalSend(body);
            }
            return originalSend(Buffer.from(sanitizeStringContent(body.toString("utf-8")), "utf-8"));
        }
        return originalSend(sanitizeForClient(body));
    }) as typeof res.send;

    next();
});

apiRouter.get("/", (_req, res) => {
    // for healthcheck
    res.send("Hello from the API!");
});

apiRouter.get("/workspace", apiHandler(async (_req, res) => {
    const workspaceDir = getWorkspaceDirFromEnv();
    res.json({ workspace_dir: workspaceDir });
}, false));

apiRouter.use('/workflows', workflowsRouter);
apiRouter.use('/chat', chatRouter);
apiRouter.use('/skills', skillsRouter);
apiRouter.use('/users', usersRouter);
apiRouter.use('/opencode-auth', opencodeAuthRouter);

app.use('/api', apiRouter);

// Serve static assets (JS, CSS, etc.) with correct MIME types
app.use(express.static(frontendDistDirectory));

// SPA fallback: serve index.html for non-API routes (client-side routing)
app.get("*", (_req, res) => {
    res.sendFile(path.join(frontendDistDirectory, "index.html"));
});

app.use(async (err: any, req: express.Request, res: express.Response, _: express.NextFunction) => {
    let status = err.status || 500;
    let doLogging = err.doLogging !== false;
    if (status !== 404 && doLogging) {
        logError({ err, apiPath: req.path, apiMethod: req.method });
    }
    res.status(status).json({ message: err.message || 'Unknown error' });
})

let httpServer: Server | null = null;
let isShuttingDown = false;

async function shutdown(exitCode: number) {
    if (isShuttingDown) {
        return;
    }
    isShuttingDown = true;

    stopOpencodeServer();

    if (httpServer) {
        await new Promise<void>((resolve) => {
            httpServer!.close(() => resolve());
        });
    }

    process.exit(exitCode);
}

async function bootstrap() {
    await initializeWorkspaceDirectory();
    await initializeOpencodeAuthStorage();
    await ensureWorkspaceDatabase();
    await loadJwtSecret();
    await startOpencodeServer();
    startCronJobs();

    const TEAMCOPILOT_HOST = assertEnv("TEAMCOPILOT_HOST");
    const TEAMCOPILOT_PORT = parseIntStrict(assertEnv("TEAMCOPILOT_PORT"), "TEAMCOPILOT_PORT");
    httpServer = app.listen(TEAMCOPILOT_PORT, TEAMCOPILOT_HOST, () => {
        console.log(`Server running at http://${TEAMCOPILOT_HOST}:${TEAMCOPILOT_PORT}`);
    });
}

process.on("SIGINT", () => {
    void shutdown(0);
});

process.on("SIGTERM", () => {
    void shutdown(0);
});

process.on("uncaughtException", (err) => {
    console.error("Uncaught exception:", err);
    void shutdown(1);
});

process.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection:", reason);
    void shutdown(1);
});

void bootstrap().catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
});
