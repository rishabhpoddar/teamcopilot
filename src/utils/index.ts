import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client";

type CustomRequest = express.Request & {
    userId?: string;
    email?: string;
    name?: string;
    role?: string;
}

export function apiHandler(handler: (req: CustomRequest, res: express.Response, next: express.NextFunction) => Promise<void>, requireAuth: boolean) {
    return async (req: express.Request, res: express.Response, next: express.NextFunction) => {
        try {
            let authHeader = req.headers['authorization'];
            if (!authHeader && requireAuth) {
                throw {
                    status: 401,
                    message: 'Missing authorization header. Please pass an authorization bearer token in the header.'
                };
            }
            if (authHeader) {
                try {
                    const token = authHeader.split(' ')[1];
                    const decoded = jwt.verify(token, process.env.JWT_SECRET!);
                    let user = await prisma.users.findUnique({
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
                } catch (e) {
                    if (e instanceof jwt.JsonWebTokenError) {
                        throw {
                            status: 401,
                            message: 'Invalid authorization token. Please pass a valid authorization bearer token in the header.'
                        };
                    }
                    throw e;
                }
            }
            await handler(req as CustomRequest, res, next);
        } catch (e) {
            next(e);
        }
    }
}