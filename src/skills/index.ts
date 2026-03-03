import express from "express";
import prisma from "../prisma/client";
import { SkillSummary } from "../types/skill";
import { apiHandler } from "../utils";
import { getOrCreateSkillMetadata, listSkillSlugs, readSkillManifest } from "../utils/skill";

const router = express.Router({ mergeParams: true });

router.get("/", apiHandler(async (req, res) => {
    const slugs = listSkillSlugs();
    const skills: SkillSummary[] = [];
    const creatorIds = new Set<string>();

    const metadataBySlug = new Map<string, Awaited<ReturnType<typeof getOrCreateSkillMetadata>>>();
    for (const slug of slugs) {
        const metadata = await getOrCreateSkillMetadata(slug);
        metadataBySlug.set(slug, metadata);
        if (metadata.created_by_user_id) {
            creatorIds.add(metadata.created_by_user_id);
        }
    }

    const creators = creatorIds.size > 0
        ? await prisma.users.findMany({
            where: {
                id: { in: Array.from(creatorIds) }
            },
            select: {
                id: true,
                name: true,
                email: true,
            }
        })
        : [];
    const creatorNameById = new Map(creators.map((creator) => [creator.id, creator.name]));
    const creatorEmailById = new Map(creators.map((creator) => [creator.id, creator.email]));

    for (const slug of slugs) {
        const manifest = readSkillManifest(slug);
        const metadata = metadataBySlug.get(slug);
        if (!metadata) continue;
        const allowedUserCount = await prisma.skill_access_permission_users.count({
            where: { skill_slug: slug }
        });
        const hasApprovedSnapshot = await prisma.skill_approved_snapshots.findUnique({
            where: { skill_slug: slug },
            select: { skill_slug: true }
        });
        const createdByUserId = metadata.created_by_user_id;
        skills.push({
            slug,
            name: manifest.name,
            description: manifest.description,
            created_by_user_id: createdByUserId,
            created_by_user_name: createdByUserId ? (creatorNameById.get(createdByUserId) ?? null) : null,
            created_by_user_email: createdByUserId ? (creatorEmailById.get(createdByUserId) ?? null) : null,
            approved_by_user_id: metadata.approved_by_user_id,
            is_approved: Boolean(hasApprovedSnapshot),
            access_permission_mode: metadata.access_permission_mode,
            allowed_user_count: allowedUserCount,
        });
    }

    res.json({ skills });
}, true));

export default router;
