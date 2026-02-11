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
import cors from "cors";
import prisma from "./prisma/client";
import { logError, logInfo } from "./logging";
import authRouter from "./auth";
import workflowsRouter from "./workflows";
import { startCronJobs } from "./cronjob";
import path from 'path';
const app = express();

app.use(express.json());

app.use(cors({
    origin: process.env.SERVICE_URL,
    credentials: true
}));

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

const apiRouter = express.Router();

apiRouter.get("/", (req, res) => {
    // for healthcheck
    res.send("Hello from the API!");
});

apiRouter.use('/auth', authRouter);
apiRouter.use('/workflows', workflowsRouter);

app.use('/api', apiRouter);

// Serve static assets (JS, CSS, etc.) with correct MIME types
app.use(express.static(path.join(__dirname, "..", "frontend", "dist")));

// SPA fallback: serve index.html for non-API routes (client-side routing)
app.get("*", (req, res) => {
    res.sendFile(path.join(__dirname, "..", "frontend", "dist", "index.html"));
});

app.use(async (err: any, req: express.Request, res: express.Response, _: express.NextFunction) => {
    let status = err.status || 500;
    let clientMessage = status === 500 ? 'Internal server error' : (err.message || 'Unknown error');
    if (status !== 404) {
        logError({ err, apiPath: req.path, apiMethod: req.method });
    }
    res.status(status).json({ message: clientMessage });
})

startCronJobs();

app.listen(3000);