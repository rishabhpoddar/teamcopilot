import express from "express";
import jwt from "jsonwebtoken";
import prisma from "../prisma/client";
import { assertCondition } from "./assert";
import { getJwtSecret } from "./jwt-secret";

type CustomRequest = express.Request & {
    userId?: string;
    email?: string;
    name?: string;
    role?: string;
    opencode_session_id?: string;
    tokenUse?: "access" | "password_change";
    mustChangePassword?: boolean;
}

function nowMs(): bigint {
    return BigInt(Date.now());
}

export async function reconcileRunningCronsAndWorkflowRunsOnStartup(): Promise<void> {
    const completedAt = nowMs();
    const workflowError = "Workflow run was interrupted because the backend restarted.";
    const cronjobError = "Cronjob run was interrupted because the backend restarted.";

    await prisma.workflow_runs.updateMany({
        where: { status: "running" },
        data: {
            status: "failed",
            completed_at: completedAt,
            error_message: workflowError,
        },
    });

    await prisma.cronjob_runs.updateMany({
        where: { status: "running" },
        data: {
            status: "failed",
            completed_at: completedAt,
            error_message: cronjobError,
        },
    });
}

export function apiHandler(
    handler: (req: CustomRequest, res: express.Response, next: express.NextFunction) => Promise<void>,
    requireAuth: boolean
) {
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
                    const decoded = jwt.verify(rawToken, getJwtSecret());
                    const payload = decoded as { sub?: string; token_use?: string };
                    assertCondition(typeof payload.sub === "string" && payload.sub.length > 0, "Invalid authorization token subject");
                    const user = await prisma.users.findUnique({
                        where: {
                            id: payload.sub
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
                    (req as CustomRequest).tokenUse = payload.token_use === "password_change" ? "password_change" : "access";
                    (req as CustomRequest).mustChangePassword = user.must_change_password;
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
                            (req as CustomRequest).tokenUse = "access";
                            (req as CustomRequest).mustChangePassword = session.user.must_change_password;
                            (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
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
            if (requireAuth && (req as CustomRequest).tokenUse === "password_change") {
                throw {
                    status: 401,
                    message: 'This token can only be used to complete password change.'
                };
            }
            if (requireAuth && (req as CustomRequest).tokenUse === "access" && (req as CustomRequest).mustChangePassword) {
                throw {
                    status: 401,
                    message: "Password change is required before using this access token."
                };
            }
            await handler(req as CustomRequest, res, next);
        } catch (e) {
            next(e);
        }
    }
}
