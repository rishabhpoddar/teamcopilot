import express from "express";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import prisma from "../prisma/client";
import { apiHandler } from "../utils";

const router = express.Router({ mergeParams: true });

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
    throw new Error('JWT_SECRET is not set');
}

router.post('/signup', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    try {
        const { email, name, password, role } = req.body;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }
        if (!name || name.trim().length === 0) {
            return res.status(400).json({ error: 'Name is required' });
        }
        if (!password || password.length < 8) {
            return res.status(400).json({ error: 'Password must be at least 8 characters' });
        }
        if (!role || !['User', 'Engineer'].includes(role)) {
            return res.status(400).json({ error: 'Role must be either "User" or "Engineer"' });
        }

        const existing = await prisma.users.findUnique({ where: { email } });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        const password_hash = await bcrypt.hash(password, 12);
        const user = await prisma.users.create({
            data: { email, name: name.trim(), role, password_hash, created_at: Date.now() }
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

router.post('/signin', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

router.post('/reset-password', (async (req: express.Request, res: express.Response, next: express.NextFunction) => {
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

router.get('/me', apiHandler(async (req, res) => {
    res.send({
        userId: req.userId,
        email: req.email,
        name: req.name
    });
}, true));


export default router;
