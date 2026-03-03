import fs from "fs";
import path from "path";
import prisma from "../prisma/client";
import { getWorkspaceDirFromEnv } from "./workspace-sync";

export interface SkillManifest {
    name: string;
    description: string;
}

export interface SkillMetadata {
    skill_slug: string;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
    access_permission_mode: "restricted";
}

function getSkillsRootPath(): string {
    return path.join(getWorkspaceDirFromEnv(), ".custom-skills");
}

export function getSkillPath(slug: string): string {
    return path.join(getSkillsRootPath(), slug);
}

export function getSkillManifestPath(slug: string): string {
    return path.join(getSkillPath(slug), "SKILL.md");
}

export function listSkillSlugs(): string[] {
    const skillsDir = getSkillsRootPath();
    if (!fs.existsSync(skillsDir)) {
        return [];
    }

    const entries = fs.readdirSync(skillsDir, { withFileTypes: true });
    const slugs: string[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const skillManifestPath = path.join(skillsDir, entry.name, "SKILL.md");
        if (fs.existsSync(skillManifestPath)) {
            slugs.push(entry.name);
        }
    }

    return slugs;
}

function extractFrontmatterValue(frontmatter: string, key: string): string | null {
    const pattern = new RegExp(`^${key}\\s*:\\s*(.+)$`, "m");
    const match = frontmatter.match(pattern);
    if (!match) {
        return null;
    }
    return match[1]?.trim().replace(/^["']|["']$/g, "") ?? null;
}

export function readSkillManifest(slug: string): SkillManifest {
    const skillManifestPath = getSkillManifestPath(slug);
    if (!fs.existsSync(skillManifestPath)) {
        throw {
            status: 404,
            message: `Skill manifest not found for slug: ${slug}`
        };
    }

    const content = fs.readFileSync(skillManifestPath, "utf-8");
    const frontmatterMatch = content.match(/^---\s*\n([\s\S]*?)\n---\s*/);
    const frontmatter = frontmatterMatch?.[1] ?? "";

    const name = extractFrontmatterValue(frontmatter, "name") ?? slug;
    const description = extractFrontmatterValue(frontmatter, "description") ?? "";

    return {
        name,
        description,
    };
}

function mapSkillMetadataRow(row: {
    skill_slug: string;
    created_by_user_id: string | null;
    approved_by_user_id: string | null;
    access_permission_mode: string;
}): SkillMetadata {
    if (row.access_permission_mode !== "restricted") {
        throw {
            status: 500,
            message: `Invalid skill access permission mode: ${row.access_permission_mode}`
        };
    }

    return {
        skill_slug: row.skill_slug,
        created_by_user_id: row.created_by_user_id,
        approved_by_user_id: row.approved_by_user_id,
        access_permission_mode: row.access_permission_mode,
    };
}

export async function getOrCreateSkillMetadata(slug: string): Promise<SkillMetadata> {
    readSkillManifest(slug);

    const existing = await prisma.skill_metadata.findUnique({
        where: { skill_slug: slug }
    });
    if (existing) {
        return mapSkillMetadataRow(existing);
    }

    const now = BigInt(Date.now());
    const created = await prisma.skill_metadata.create({
        data: {
            skill_slug: slug,
            access_permission_mode: "restricted",
            created_at: now,
            updated_at: now,
        }
    });

    return mapSkillMetadataRow(created);
}
