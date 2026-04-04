import { createResourceFileManager } from "./resource-files";
import { getWorkflowPath } from "./workflow";
import fs from "fs";
import path from "path";
import { validateWorkflowSecretContract } from "./secret-contract-validation";

const workflowFileManager = createResourceFileManager({
    getResourcePath: getWorkflowPath,
    resourceLabel: "workflow",
    editorLabel: "Workflow",
    validateBeforeSave: ({ resourcePath, relativePath, nextContent }) => {
        if (relativePath !== "workflow.json" && relativePath !== "run.py") {
            return;
        }

        const workflowJsonPath = path.join(resourcePath, "workflow.json");
        const runPyPath = path.join(resourcePath, "run.py");
        const workflowJsonContent = relativePath === "workflow.json"
            ? nextContent
            : fs.readFileSync(workflowJsonPath, "utf-8");
        const runPyContent = relativePath === "run.py"
            ? nextContent
            : fs.readFileSync(runPyPath, "utf-8");

        validateWorkflowSecretContract({
            workflowJsonContent,
            runPyContent,
        });
    }
});

export const listWorkflowDirectory = workflowFileManager.listDirectory;
export const readWorkflowFileContent = workflowFileManager.readFileContent;
export const saveWorkflowFileContent = workflowFileManager.saveFileContent;
export const createWorkflowFileOrFolder = workflowFileManager.createFileOrFolder;
export const uploadWorkflowFileFromTempPath = workflowFileManager.uploadFileFromTempPath;
export const renameWorkflowPath = workflowFileManager.renamePath;
export const deleteWorkflowPath = workflowFileManager.deletePath;
