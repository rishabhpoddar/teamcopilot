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
import axios from "axios";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import cookieParser from "cookie-parser";
import path from 'path';
const app = express();

const JWT_SECRET = process.env.JWT_SECRET

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
}

app.use(express.json());

app.use(cors({
    origin: process.env.WEBSITE_URL,
    credentials: true
}));

// Use cookie-parser middleware
app.use(cookieParser());

// Logging middleware
app.use((req, res, next) => {
    const start = Date.now();
    res.on('finish', async () => {
        const duration = Date.now() - start;
        const logData = {
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            duration: `${duration}ms`,
            userAgent: req.get('user-agent'),
            ip: req.ip
        };
        await logInfo(`HTTP Request: ${req.method} ${req.path} ${res.statusCode}`, { meta: logData });
    });
    next();
});

const apiRouter = express.Router();

apiRouter.get("/", (req, res) => {
    // for healthcheck
    res.send("Hello from the API!");
});

apiRouter.get('/auth/google', (req, res) => {
    const redirectUri = 'https://accounts.google.com/o/oauth2/v2/auth?' +
        new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID!,
            redirect_uri: process.env.API_URL + "/api/auth/google/callback",
            response_type: 'code',
            scope: 'email profile',
            state: crypto.randomBytes(16).toString('hex') // Add state parameter for security
        }).toString();

    res.redirect(redirectUri);
});

apiRouter.get('/auth/google/callback', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const code = req.query.code;
    const error = req.query.error;

    if (error) {
        return res.redirect(`${process.env.WEBSITE_URL}/login`);
    }

    try {
        // Exchange code for tokens
        const { data } = await axios.post('https://oauth2.googleapis.com/token', {
            code,
            client_id: process.env.GOOGLE_CLIENT_ID!,
            redirect_uri: process.env.API_URL + "/api/auth/google/callback",
            grant_type: 'authorization_code',
            client_secret: process.env.GOOGLE_CLIENT_SECRET!,
        }, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
            }
        });

        const { access_token } = data;

        // Get user info
        const userInfo = await axios.get(`https://www.googleapis.com/oauth2/v3/userinfo`, {
            headers: { Authorization: `Bearer ${access_token}` },
        });

        let googleUserId = userInfo.data.sub;
        let email = userInfo.data.email;
        let name = userInfo.data.name;

        // sending slack notification if the user is not in the database..
        const userExists = await prisma.users.findFirst({ where: { google_user_id: googleUserId } });

        let userInDb = await prisma.users.upsert({
            where: { google_user_id: googleUserId },
            update: { email, name },
            create: { email, name, google_user_id: googleUserId, created_at: Date.now() }
        });

        // Create JWT token
        const token = jwt.sign(
            {
                sub: userInDb.id,
                email: userInDb.email,
                name: userInDb.name
            },
            JWT_SECRET,
            { expiresIn: '365d' }
        );

        // Redirect with the token
        res.redirect(`${process.env.WEBSITE_URL}/auth-success?token=${token}`);
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