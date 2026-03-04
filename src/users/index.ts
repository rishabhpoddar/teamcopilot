import express from "express";
import prisma from "../prisma/client";
import { apiHandler } from "../utils/index";

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

export default router;
