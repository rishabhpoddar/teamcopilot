import express from "express";
import { apiHandler } from "../utils";
import { buildUsageOverview } from "../utils/chat-usage";

const router = express.Router({ mergeParams: true });

router.get("/overview", apiHandler(async (req, res) => {
    const overview = await buildUsageOverview(req.query.range);
    res.json(overview);
}, true));

export default router;
