import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../prisma/client";
import { apiHandler } from "../utils/index";
import { assertEnv } from "../utils/assert";

const router = express.Router({ mergeParams: true });

const JWT_SECRET = assertEnv('JWT_SECRET');

type PasswordChangeTokenPayload = {
    sub: string;
    email: string;
    name: string;
    token_use: "password_change";
};

function issueAccessToken(user: { id: string; email: string; name: string }): string {
    return jwt.sign(
        { sub: user.id, email: user.email, name: user.name },
        JWT_SECRET,
        { expiresIn: '365d' }
    );
}

function issuePasswordChangeToken(user: { id: string; email: string; name: string }): string {
    return jwt.sign(
        { sub: user.id, email: user.email, name: user.name, token_use: 'password_change' },
        JWT_SECRET,
        { expiresIn: '10m' }
    );
}

function parsePasswordChangeToken(rawToken: string): PasswordChangeTokenPayload {
    const decoded = jwt.verify(rawToken, JWT_SECRET);
    if (typeof decoded !== 'object' || decoded === null) {
        throw {
            status: 401,
            message: 'Invalid password change challenge token'
        };
    }

    const payload = decoded as Record<string, unknown>;
    if (typeof payload.sub !== 'string' || typeof payload.email !== 'string' || typeof payload.name !== 'string' || payload.token_use !== 'password_change') {
        throw {
            status: 401,
            message: 'Invalid password change challenge token'
        };
    }

    return {
        sub: payload.sub,
        email: payload.email,
        name: payload.name,
        token_use: 'password_change'
    };
}

router.post('/signin', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            throw {
                status: 400,
                message: 'Email and password are required'
            };
        }

        const user = await prisma.users.findUnique({ where: { email } });
        if (!user) {
            throw {
                status: 401,
                message: 'Invalid email or password'
            };
        }

        const valid = await bcrypt.compare(password, user.password_hash);
        if (!valid) {
            throw {
                status: 401,
                message: 'Invalid email or password'
            };
        }

        if (user.must_change_password) {
            const challengeToken = issuePasswordChangeToken(user);
            res.json({
                requires_password_change: true,
                challenge_token: challengeToken
            });
            return;
        }

        const token = issueAccessToken(user);
        res.json({ token });
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

router.post('/complete-password-change', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { challengeToken, newPassword } = req.body;

        if (!challengeToken || !newPassword) {
            throw {
                status: 400,
                message: 'challengeToken and newPassword are required'
            };
        }
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            throw {
                status: 400,
                message: 'Password must be at least 8 characters'
            };
        }

        let payload: PasswordChangeTokenPayload;
        try {
            payload = parsePasswordChangeToken(challengeToken);
        } catch (error) {
            if (error instanceof jwt.JsonWebTokenError || error instanceof jwt.TokenExpiredError) {
                throw {
                    status: 401,
                    message: 'Invalid or expired password change challenge token'
                };
            }
            throw error;
        }

        const user = await prisma.users.findUnique({ where: { id: payload.sub } });
        if (!user || user.email !== payload.email || user.name !== payload.name) {
            throw {
                status: 401,
                message: 'Invalid password change challenge token'
            };
        }

        if (!user.must_change_password) {
            throw {
                status: 400,
                message: 'Password change is not required for this user'
            };
        }

        const password_hash = await bcrypt.hash(newPassword, 12);
        await prisma.users.update({
            where: { id: user.id },
            data: {
                password_hash,
                must_change_password: false,
                reset_token: null,
                reset_token_expires_at: null
            }
        });

        const token = issueAccessToken(user);
        res.json({ token });
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

router.post('/reset-password', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { token, newPassword } = req.body;

        if (!token || !newPassword) {
            throw {
                status: 400,
                message: 'Token and newPassword are required'
            };
        }
        if (typeof newPassword !== 'string' || newPassword.length < 8) {
            throw {
                status: 400,
                message: 'Password must be at least 8 characters'
            };
        }

        const user = await prisma.users.findFirst({
            where: {
                reset_token: token,
                reset_token_expires_at: { gt: Date.now() }
            }
        });

        if (!user) {
            throw {
                status: 400,
                message: 'Invalid or expired reset token'
            };
        }

        const password_hash = await bcrypt.hash(newPassword, 12);
        await prisma.users.update({
            where: { id: user.id },
            data: {
                password_hash,
                must_change_password: false,
                reset_token: null,
                reset_token_expires_at: null
            }
        });

        res.json({ message: 'Password reset successfully' });
    } catch (err) {
        next(err);
    }
}) as express.RequestHandler);

router.post('/signout', apiHandler(async (_req, res) => {
    res.json({ message: 'Signed out' });
}, true, { allowPasswordChangeToken: true }));

router.get('/me', apiHandler(async (req, res) => {
    res.json({
        userId: req.userId,
        email: req.email,
        name: req.name,
        role: req.role
    });
}, true));

export default router;
