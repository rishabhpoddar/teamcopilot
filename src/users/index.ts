import express from "express";
import prisma from "../prisma/client";
import { apiHandler } from "../utils/index";
import { assertSecretKey, toSecretListItem } from "../utils/secrets";

const router = express.Router({ mergeParams: true });

router.get("/", apiHandler(async (_req, res) => {
    const users = await prisma.users.findMany({
        orderBy: { name: "asc" },
        select: {
            id: true,
            name: true,
            email: true,
            role: true
        }
    });
    res.json({ users });
}, true));

router.get("/me/secrets", apiHandler(async (req, res) => {
    const rows = await prisma.user_secrets.findMany({
        where: {
            user_id: req.userId!,
        },
        orderBy: { key: "asc" }
    });
    const shouldMaskValues = req.opencode_session_id === undefined;

    res.json({
        secrets: rows.map((row) => toSecretListItem(row, shouldMaskValues))
    });
}, true));

router.put("/me/secrets/:key", apiHandler(async (req, res) => {
    const key = assertSecretKey(req.params.key as string);
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    if (value.length === 0) {
        throw {
            status: 400,
            message: "value is required"
        };
    }

    const now = BigInt(Date.now());
    const row = await prisma.user_secrets.upsert({
        where: {
            user_id_key: {
                user_id: req.userId!,
                key,
            }
        },
        create: {
            user_id: req.userId!,
            key,
            value,
            created_at: now,
            updated_at: now,
        },
        update: {
            value,
            updated_at: now,
        }
    });

    res.json({
        secret: toSecretListItem(row, req.opencode_session_id === undefined)
    });
}, true));

router.delete("/me/secrets/:key", apiHandler(async (req, res) => {
    const key = assertSecretKey(req.params.key as string);
    await prisma.user_secrets.delete({
        where: {
            user_id_key: {
                user_id: req.userId!,
                key,
            }
        }
    }).catch(() => {
        throw {
            status: 404,
            message: `Secret not found for key: ${key}`
        };
    });

    res.json({ success: true });
}, true));

export default router;
