import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client";
import { assertCondition, assertEnv } from "./assert";

type CustomRequest = express.Request & {
    userId?: string;
    email?: string;
    name?: string;
    role?: string;
    opencode_session_id?: string;
}

export function apiHandler(handler: (req: CustomRequest, res: express.Response, next: express.NextFunction) => Promise<void>, requireAuth: boolean) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            const authHeader = req.headers['authorization'];
            if (!authHeader && requireAuth) {
                throw {
                    status: 401,
                    message: 'Missing authorization header. Please pass an authorization bearer token in the header.'
                };
            }
            if (authHeader) {
                const rawToken = authHeader.split(' ')[1];
                assertCondition(rawToken, 'Missing authorization bearer token');
                try {
                    const decoded = jwt.verify(rawToken, assertEnv("JWT_SECRET"));
                    const user = await prisma.users.findUnique({
                        where: {
                            id: (decoded as { sub: string }).sub
                        }
                    });

                    if (!user) {
                        throw {
                            status: 401,
                            message: 'Invalid authorization token. Please pass a valid authorization bearer token in the header.'
                        };
                    }
                    (req as CustomRequest).userId = user.id;
                    (req as CustomRequest).email = user.email;
                    (req as CustomRequest).name = user.name;
                    (req as CustomRequest).role = user.role;
                    (req as CustomRequest).opencode_session_id = undefined;
                } catch (e) {
                    if (e instanceof jwt.JsonWebTokenError || e instanceof jwt.TokenExpiredError) {
                        const session = await prisma.chat_sessions.findFirst({
                            where: { opencode_session_id: rawToken },
                            include: {
                                user: true
                            }
                        });

                        if (session) {
                            (req as CustomRequest).userId = session.user.id;
                            (req as CustomRequest).email = session.user.email;
                            (req as CustomRequest).name = session.user.name;
                            (req as CustomRequest).role = session.user.role;
                            (req as CustomRequest).opencode_session_id = session.opencode_session_id;
                        }
                    } else {
                        throw e;
                    }
                }
            }

            if (requireAuth && !(req as CustomRequest).userId) {
                throw {
                    status: 401,
                    message: 'Invalid authorization token. Please pass a valid authorization bearer token in the header.'
                };
            }
            await handler(req as CustomRequest, res, next);
        } catch (e) {
            next(e);
        }
    }
}
