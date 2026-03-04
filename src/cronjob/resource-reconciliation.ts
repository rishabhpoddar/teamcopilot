import prisma from "../prisma/client";
import { deleteSkill, listSkillSlugs } from "../utils/skill";
import { deleteWorkflow, listWorkflowSlugs } from "../utils/workflow";

export async function reconcileResourceMetadataWithFilesystem(): Promise<void> {
    const dbEntries = await prisma.resource_metadata.findMany({
        where: {
            resource_kind: {
                in: ["workflow", "skill"]
            }
        },
        select: {
            resource_kind: true,
            resource_slug: true
        }
    });

    const workflowSlugsOnDisk = new Set(listWorkflowSlugs());
    const skillSlugsOnDisk = new Set(listSkillSlugs());

    for (const entry of dbEntries) {
        if (entry.resource_kind === "workflow" && !workflowSlugsOnDisk.has(entry.resource_slug)) {
            await deleteWorkflow(entry.resource_slug);
            continue;
        }
        if (entry.resource_kind === "skill" && !skillSlugsOnDisk.has(entry.resource_slug)) {
            await deleteSkill(entry.resource_slug);
        }
    }
}
