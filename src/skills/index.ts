import express from "express";
import fs from "fs";
import os from "os";
import path from "path";
import multer from "multer";
import prisma from "../prisma/client";
import { SkillSummary } from "../types/skill";
import { apiHandler } from "../utils";
import { createSkill, deleteSkillDirectory, getOrCreateSkillMetadata, listSkillSlugs, readSkillManifest } from "../utils/skill";
import {
    getSkillAccessPermissionWithUsers,
    getSkillPermissionSummaryFields,
    mapSkillPermissionToApi,
    setSkillAccessPermissions,
} from "../utils/skill-permissions";
import {
    createSkillFileOrFolder,
    deleteSkillPath,
    listSkillDirectory,
    readSkillFileContent,
    renameSkillPath,
    saveSkillFileContent,
    uploadSkillFileFromTempPath,
} from "../utils/skill-files";
import { WorkflowEditorAccessResponse } from "../types/workflow-files";

const router = express.Router({ mergeParams: true });
const uploadTmpDir = path.join(os.tmpdir(), "localtool-skill-uploads");
fs.mkdirSync(uploadTmpDir, { recursive: true });
const skillFileUpload = multer({ dest: uploadTmpDir, limits: { files: 1 } });

function normalizeSkillNameOrSlug(value: string): string {
    return value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9\s-]/g, "")
        .replace(/\s+/g, "-")
        .replace(/-+/g, "-");
}

async function getSkillEditorAccess(slug: string, userId: string, role: string | undefined): Promise<WorkflowEditorAccessResponse> {
    const metadata = await getOrCreateSkillMetadata(slug);
    const permission = await getSkillAccessPermissionWithUsers(slug);
    const permissionSummary = getSkillPermissionSummaryFields(permission, userId);
    const hasApprovedSnapshot = await prisma.skill_approved_snapshots.findUnique({
        where: { skill_slug: slug },
        select: { skill_slug: true }
    });
    const skillStatus = hasApprovedSnapshot ? "approved" : "pending";
    const isEngineer = role === "Engineer";
    const isOwner = metadata.created_by_user_id === userId;
    const canEdit = skillStatus === "approved"
        ? permissionSummary.can_current_user_use_skill
        : (isOwner || isEngineer);

    return {
        can_view: true,
        can_edit: canEdit,
        workflow_status: skillStatus,
    };
}

async function assertCanEditSkillFiles(slug: string, userId: string, role: string | undefined): Promise<void> {
    const access = await getSkillEditorAccess(slug, userId, role);
    if (!access.can_edit) {
        throw {
            status: 403,
            message: "You do not have permission to edit this skill"
        };
    }
}

router.post("/", apiHandler(async (req, res) => {
    const body = req.body as {
        slug?: unknown;
        name?: unknown;
    };
    const rawSlug = typeof body.slug === "string" ? body.slug : "";
    const rawName = typeof body.name === "string" ? body.name : "";
    const normalizedSlug = normalizeSkillNameOrSlug(rawSlug);
    const normalizedName = normalizeSkillNameOrSlug(rawName);
    const unifiedName = normalizedName || normalizedSlug;

    if (!unifiedName) {
        throw {
            status: 400,
            message: "name is required"
        };
    }

    await createSkill({
        slug: unifiedName,
        name: unifiedName,
        createdByUserId: req.userId!,
    });

    res.status(201).json({ success: true });
}, true));

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
        const permission = await getSkillAccessPermissionWithUsers(slug);
        const permissionSummary = getSkillPermissionSummaryFields(permission, req.userId!);
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
            ...permissionSummary,
        });
    }

    res.json({ skills });
}, true));

router.get("/users", apiHandler(async (_req, res) => {
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

router.get("/:slug", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const metadata = await getOrCreateSkillMetadata(slug);
    const manifest = readSkillManifest(slug);

    const createdByUserId = metadata.created_by_user_id ?? null;
    const approvedByUserId = metadata.approved_by_user_id ?? null;
    const userIds = [createdByUserId, approvedByUserId].filter((id): id is string => typeof id === "string");
    const users = userIds.length > 0
        ? await prisma.users.findMany({
            where: { id: { in: userIds } },
            select: { id: true, name: true, email: true }
        })
        : [];
    const usersById = new Map(users.map((user) => [user.id, user]));
    const creator = createdByUserId ? (usersById.get(createdByUserId) ?? null) : null;
    const approver = approvedByUserId ? (usersById.get(approvedByUserId) ?? null) : null;
    const permission = await getSkillAccessPermissionWithUsers(slug);
    const permissionSummary = getSkillPermissionSummaryFields(permission, req.userId!);

    res.json({
        workflow: {
            slug,
            name: manifest.name,
            created_by_user_id: createdByUserId,
            created_by_user_name: creator?.name ?? null,
            created_by_user_email: creator?.email ?? null,
            approved_by_user_id: approvedByUserId,
            approved_by_user_name: approver?.name ?? null,
            approved_by_user_email: approver?.email ?? null,
            ...permissionSummary,
            access_permissions: mapSkillPermissionToApi(permission),
            allowed_users_resolved: permission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            })),
        }
    });
}, true));

router.get("/:slug/files/access", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const access = await getSkillEditorAccess(slug, req.userId!, req.role);
    res.json(access);
}, true));

router.get("/:slug/files/tree", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await getOrCreateSkillMetadata(slug);
    const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
    const tree = listSkillDirectory(slug, rawPath);
    res.json(tree);
}, true));

router.get("/:slug/files/content", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await getOrCreateSkillMetadata(slug);
    const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
    const content = readSkillFileContent(slug, rawPath);
    (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
    res.json(content);
}, true));

router.put("/:slug/files/content", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditSkillFiles(slug, req.userId!, req.role);
    const { path, content, base_etag } = req.body as { path?: unknown; content?: unknown; base_etag?: unknown };
    if (typeof path !== "string" || typeof content !== "string" || typeof base_etag !== "string") {
        throw {
            status: 400,
            message: "path, content, and base_etag are required"
        };
    }
    const result = saveSkillFileContent(slug, { path, content, base_etag });
    res.json(result);
}, true));

router.post("/:slug/files", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditSkillFiles(slug, req.userId!, req.role);
    const { parent_path, name, kind } = req.body as { parent_path?: unknown; name?: unknown; kind?: unknown };
    if (typeof name !== "string" || (kind !== "file" && kind !== "directory")) {
        throw {
            status: 400,
            message: 'name and kind ("file" or "directory") are required'
        };
    }
    const node = createSkillFileOrFolder(slug, typeof parent_path === "string" ? parent_path : "", name, kind);
    res.json({ node });
}, true));

router.post("/:slug/files/upload", skillFileUpload.single("file"), apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditSkillFiles(slug, req.userId!, req.role);
    const { parent_path, name } = req.body as { parent_path?: unknown; name?: unknown };
    if (typeof name !== "string") {
        throw {
            status: 400,
            message: "name is required"
        };
    }
    if (!req.file?.path) {
        throw {
            status: 400,
            message: "file is required"
        };
    }
    try {
        const node = uploadSkillFileFromTempPath(slug, typeof parent_path === "string" ? parent_path : "", name, req.file.path);
        res.json({ node });
    } finally {
        if (fs.existsSync(req.file.path)) {
            fs.unlinkSync(req.file.path);
        }
    }
}, true));

router.patch("/:slug/files/rename", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditSkillFiles(slug, req.userId!, req.role);
    const { path, new_name } = req.body as { path?: unknown; new_name?: unknown };
    if (typeof path !== "string" || typeof new_name !== "string") {
        throw {
            status: 400,
            message: "path and new_name are required"
        };
    }
    const result = renameSkillPath(slug, path, new_name);
    res.json(result);
}, true));

router.delete("/:slug/files", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    await assertCanEditSkillFiles(slug, req.userId!, req.role);
    const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
    deleteSkillPath(slug, rawPath);
    res.json({ success: true });
}, true));

router.patch("/:slug/access-permissions", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const metadata = await getOrCreateSkillMetadata(slug);
    const hasApprovedSnapshot = await prisma.skill_approved_snapshots.findUnique({
        where: { skill_slug: slug },
        select: { skill_slug: true }
    });
    if (!hasApprovedSnapshot) {
        throw {
            status: 403,
            message: "Skill must be approved before updating access permissions"
        };
    }

    const currentPermission = await getSkillAccessPermissionWithUsers(slug);
    const currentSummary = getSkillPermissionSummaryFields(currentPermission, req.userId!);
    if (!currentSummary.can_current_user_manage_access_permissions) {
        throw {
            status: 403,
            message: currentSummary.is_access_locked_due_to_missing_users
                ? "Skill permissions cannot be modified because no allowed users remain"
                : "You do not have permission to modify skill access permissions"
        };
    }

    const { mode, allowed_user_ids } = req.body as { mode?: string; allowed_user_ids?: unknown };
    if (mode !== "restricted" && mode !== "everyone") {
        throw {
            status: 400,
            message: 'mode must be "restricted" or "everyone"'
        };
    }

    const updatedPermission = mode === "everyone"
        ? await setSkillAccessPermissions(slug, { mode: "everyone" }, metadata.created_by_user_id)
        : await setSkillAccessPermissions(slug, {
            mode: "restricted",
            allowed_user_ids: Array.isArray(allowed_user_ids) ? allowed_user_ids.map((id) => String(id)) : []
        }, metadata.created_by_user_id);
    const updatedSummary = getSkillPermissionSummaryFields(updatedPermission, req.userId!);
    res.json({
        skill: {
            slug,
            ...updatedSummary,
            access_permissions: mapSkillPermissionToApi(updatedPermission),
            allowed_users_resolved: updatedPermission.allowedUsers.map((row) => ({
                user_id: row.user.id,
                name: row.user.name,
                email: row.user.email,
                is_owner: row.user.id === metadata.created_by_user_id,
                is_approver: row.user.id === metadata.approved_by_user_id
            }))
        }
    });
}, true));

router.delete("/:slug", apiHandler(async (req, res) => {
    const slug = req.params.slug as string;
    const metadata = await getOrCreateSkillMetadata(slug);
    const creatorUserId = metadata.created_by_user_id ?? null;

    const creator = creatorUserId
        ? await prisma.users.findUnique({
            where: { id: creatorUserId },
            select: { id: true }
        })
        : null;

    const isOwner = creatorUserId === req.userId!;
    const hasNoCreatorUser = creator === null;
    const isEngineer = req.role === "Engineer";

    if (!isOwner && !(hasNoCreatorUser && isEngineer)) {
        throw {
            status: 403,
            message: "Only the skill owner can delete this skill. Engineers can only delete skills whose owner no longer exists."
        };
    }

    await prisma.skill_metadata.deleteMany({
        where: { skill_slug: slug }
    });
    await prisma.resource_permissions.deleteMany({
        where: {
            resource_kind: "skill",
            resource_slug: slug
        }
    });
    deleteSkillDirectory(slug);

    res.json({ success: true });
}, true));

export default router;
