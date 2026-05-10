import { getResourceAccessSummary } from "./resource-access";
import { listSkillSlugs, readSkillManifestAndEnsurePermissions } from "./skill";
import { listResolvedSecretsForUser } from "./secrets";

export const ACTUAL_USER_MESSAGE_MARKER = "####### Actual user message below #######";

export async function buildAvailableSkillsPrompt(userId: string): Promise<string | null> {
    const slugs = listSkillSlugs();
    if (slugs.length === 0) {
        return null;
    }

    const availableSkills = (await Promise.all(
        slugs.map(async (slug) => {
            const accessSummary = await getResourceAccessSummary("skill", slug, userId);
            if (!accessSummary.can_view || !accessSummary.is_approved) {
                return null;
            }

            const { manifest } = await readSkillManifestAndEnsurePermissions(slug);
            return {
                path: `.agents/skills/${slug}`,
                slug,
                name: manifest.name,
                description: manifest.description,
            };
        })
    )).filter((skill): skill is {
        path: string;
        slug: string;
        name: string;
        description: string;
    } => skill !== null);

    if (availableSkills.length === 0) {
        return null;
    }

    const skillLines = availableSkills.map((skill, index) =>
        `${index + 1}. ${skill.name} (${skill.slug})\n   path: ${skill.path}\n   description: ${skill.description || "(no description provided)"}`
    );

    return `# Available custom skills\n\nThese custom skills are available to you for this session (this is also the result of calling listAvailableSkills at this point in time). Use getSkillContent tool for a specific skill when you need to inspect its SKILL.md before using it.\n\n${skillLines.join("\n\n")}`;
}

export async function buildAvailableSecretsPrompt(userId: string): Promise<string | null> {
    const secretMap = await listResolvedSecretsForUser(userId);
    const keys = Object.keys(secretMap);
    if (keys.length === 0) {
        return null;
    }

    return [
        "# Available secrets for this user",
        "",
        "These secret keys are available to the current user for this session. Reuse these exact keys when creating or editing skills and workflows whenever they fit the need.",
        "When referring to a secret in skill content or bash commands, use the proxy placeholder format {{SECRET:KEY}} instead of a raw value.",
        "If you create a skill or workflow that needs a new secret key not listed here, you may introduce that new key, but you must tell the user to add it in their Profile Secrets before the skill or workflow can be used.",
        "",
        `Available secret keys: ${keys.join(", ")}`,
    ].join("\n");
}
