import { createResourceFileManager } from "./resource-files";
import { getWorkflowPath } from "./workflow";

const workflowFileManager = createResourceFileManager({
    getResourcePath: getWorkflowPath,
    resourceLabel: "workflow",
    editorLabel: "Workflow",
});

export const listWorkflowDirectory = workflowFileManager.listDirectory;
export const readWorkflowFileContent = workflowFileManager.readFileContent;
export const saveWorkflowFileContent = workflowFileManager.saveFileContent;
export const createWorkflowFileOrFolder = workflowFileManager.createFileOrFolder;
export const uploadWorkflowFileFromTempPath = workflowFileManager.uploadFileFromTempPath;
export const renameWorkflowPath = workflowFileManager.renamePath;
export const deleteWorkflowPath = workflowFileManager.deletePath;
