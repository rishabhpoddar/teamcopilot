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
import userRouter from "./user";
import { startCronJobs } from "./cronjob";
import { apiHandler } from './utils';
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import path from 'path';
const app = express();

const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
}

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

apiRouter.post('/auth/signup', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { email, name, password } = req.body;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Name is required' });
        }
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const existing = await prisma.users.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        const password_hash = await bcrypt.hash(password, 12);
        const user = await prisma.users.create({
            data: { email, name: name.trim(), password_hash, created_at: Date.now() }
        });

        const token = jwt.sign(
            { sub: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        res.json({ token });
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

apiRouter.post('/auth/signin', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await prisma.users.findUnique({ where: { email } });
        if (!user) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const token = jwt.sign(
            { sub: user.id, email: user.email, name: user.name },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        res.json({ token });
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

apiRouter.post('/auth/reset-password', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            return res.status(400).json({ error: 'Token and new password are required' });
        }
        if (newPassword.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }

        const user = await prisma.users.findFirst({
            where: {
                reset_token: token,
                reset_token_expires_at: { gt: Date.now() }
            }
        });

        if (!user) {
            return res.status(400).json({ error: 'Invalid or expired reset token' });
        }

        const password_hash = await bcrypt.hash(newPassword, 12);
        await prisma.users.update({
            where: { id: user.id },
            data: { password_hash, reset_token: null, reset_token_expires_at: null }
        });

        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

apiRouter.get("/:version/auth/me", apiHandler(async (req, res) => {
    res.send({
        userId: req.userId,
        email: req.email,
        name: req.name
    });
}, true, ["v1"]));


apiRouter.use('/:version/user', userRouter);

apiRouter.get('/healthcheck', async (req, res) => {
    try {
        let value = await prisma.key_value.findFirst({ where: { key: 'healthcheck' } });
        if (value === null) {
            await prisma.key_value.create({ data: { key: 'healthcheck', value: 'OK' } });
        } else if (value.value !== 'OK') {
            throw new Error('Value of healthcheck is not OK');
        }
        res.send('OK');
    } catch (err) {
        res.status(500).send('Internal server error: ' + (err instanceof Error ? err.message : 'Unknown error'));
    }
});

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
    res.status(status).send(clientMessage);
})

startCronJobs();

app.listen(3000);