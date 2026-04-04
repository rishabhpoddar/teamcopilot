import express from "express";
import prisma from "../prisma/client";
import { apiHandler } from "../utils";
import { assertSecretKey, toSecretListItem } from "../utils/secrets";

const router = express.Router({ mergeParams: true });

router.get("/global", apiHandler(async (req, res) => {
    if (req.role !== "Engineer") {
        throw {
            status: 403,
            message: "Only engineers can manage global secrets"
        };
    }

    const rows = await prisma.global_secrets.findMany({
        orderBy: { key: "asc" }
    });
    const shouldMaskValues = req.opencode_session_id === undefined;

    res.json({
        secrets: rows.map((row) => toSecretListItem(row, shouldMaskValues))
    });
}, true));

router.put("/global/:key", apiHandler(async (req, res) => {
    if (req.role !== "Engineer") {
        throw {
            status: 403,
            message: "Only engineers can manage global secrets"
        };
    }

    const key = assertSecretKey(req.params.key as string);
    const value = typeof req.body?.value === "string" ? req.body.value : "";
    if (value.length === 0) {
        throw {
            status: 400,
            message: "value is required"
        };
    }

    const now = BigInt(Date.now());
    const row = await prisma.global_secrets.upsert({
        where: { key },
        create: {
            key,
            value,
            created_by_user_id: req.userId!,
            updated_by_user_id: req.userId!,
            created_at: now,
            updated_at: now,
        },
        update: {
            value,
            updated_by_user_id: req.userId!,
            updated_at: now,
        },
    });

    res.json({
        secret: toSecretListItem(row, req.opencode_session_id === undefined)
    });
}, true));

router.delete("/global/:key", apiHandler(async (req, res) => {
    if (req.role !== "Engineer") {
        throw {
            status: 403,
            message: "Only engineers can manage global secrets"
        };
    }

    const key = assertSecretKey(req.params.key as string);
    await prisma.global_secrets.delete({
        where: { key }
    }).catch(() => {
        throw {
            status: 404,
            message: `Global secret not found for key: ${key}`
        };
    });

    res.json({ success: true });
}, true));

export default router;
