import { createResourceFileManager } from "./resource-files";
import { getSkillPath } from "./skill";

const skillFileManager = createResourceFileManager({
    getResourcePath: getSkillPath,
    resourceLabel: "skill",
    editorLabel: "Skill",
});

export const listSkillDirectory = skillFileManager.listDirectory;
export const readSkillFileContent = skillFileManager.readFileContent;
export const saveSkillFileContent = skillFileManager.saveFileContent;
export const createSkillFileOrFolder = skillFileManager.createFileOrFolder;
export const uploadSkillFileFromTempPath = skillFileManager.uploadFileFromTempPath;
export const renameSkillPath = skillFileManager.renamePath;
export const deleteSkillPath = skillFileManager.deletePath;
