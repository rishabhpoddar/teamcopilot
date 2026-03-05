import express from "express";
import fs from "fs";
import { EditorAccessResponse, FileContentResponse, FileNode, FileSaveResponse, FileTreeResponse } from "../types/workflow-files";
import { apiHandler } from "./index";

type AuthenticatedRequest = express.Request & {
    userId?: string;
    role?: string;
    file?: {
        path?: string;
    };
};

interface ResourceFileRouteOptions {
    router: express.Router;
    uploadMiddleware: express.RequestHandler;
    ensureResourceExists: (slug: string) => Promise<void>;
    assertCanView: (slug: string, userId: string) => Promise<void>;
    getEditorAccess: (slug: string, userId: string) => Promise<EditorAccessResponse>;
    assertCanEdit: (slug: string, userId: string) => Promise<void>;
    listDirectory: (slug: string, rawPath: string | undefined) => FileTreeResponse;
    readFileContent: (slug: string, rawPath: string | undefined) => FileContentResponse;
    saveFileContent: (slug: string, payload: { path: string; content: string; base_etag: string }) => FileSaveResponse;
    createFileOrFolder: (slug: string, parentPath: string, name: string, kind: "file" | "directory") => FileNode;
    uploadFileFromTempPath: (slug: string, parentPath: string, name: string, tempFilePath: string) => FileNode;
    renamePath: (slug: string, path: string, newName: string) => { old_path: string; new_path: string; node: FileNode };
    deletePath: (slug: string, rawPath: string | undefined) => void;
    skipResponseSanitizationForFileContentRead?: boolean;
}

export function registerResourceFileRoutes(options: ResourceFileRouteOptions): void {
    const {
        router,
        uploadMiddleware,
        ensureResourceExists,
        assertCanView,
        getEditorAccess,
        assertCanEdit,
        listDirectory,
        readFileContent,
        saveFileContent,
        createFileOrFolder,
        uploadFileFromTempPath,
        renamePath,
        deletePath,
        skipResponseSanitizationForFileContentRead = true,
    } = options;

    router.get("/:slug/files/access", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        const access = await getEditorAccess(slug, authReq.userId!);
        res.json(access);
    }, true));

    router.get("/:slug/files/tree", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanView(slug, authReq.userId!);
        await ensureResourceExists(slug);
        const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
        const tree = listDirectory(slug, rawPath);
        res.json(tree);
    }, true));

    router.get("/:slug/files/content", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanView(slug, authReq.userId!);
        await ensureResourceExists(slug);
        const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
        const content = readFileContent(slug, rawPath);
        if (skipResponseSanitizationForFileContentRead) {
            (res.locals as { skipResponseSanitization?: boolean }).skipResponseSanitization = true;
        }
        res.json(content);
    }, true));

    router.put("/:slug/files/content", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanEdit(slug, authReq.userId!);
        const { path, content, base_etag } = req.body as { path?: unknown; content?: unknown; base_etag?: unknown };
        if (typeof path !== "string" || typeof content !== "string" || typeof base_etag !== "string") {
            throw {
                status: 400,
                message: "path, content, and base_etag are required"
            };
        }
        const result = saveFileContent(slug, { path, content, base_etag });
        res.json(result);
    }, true));

    router.post("/:slug/files", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanEdit(slug, authReq.userId!);
        const { parent_path, name, kind } = req.body as { parent_path?: unknown; name?: unknown; kind?: unknown };
        if (typeof name !== "string" || (kind !== "file" && kind !== "directory")) {
            throw {
                status: 400,
                message: 'name and kind ("file" or "directory") are required'
            };
        }
        const node = createFileOrFolder(slug, typeof parent_path === "string" ? parent_path : "", name, kind);
        res.json({ node });
    }, true));

    router.post("/:slug/files/upload", uploadMiddleware, apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanEdit(slug, authReq.userId!);
        const { parent_path, name } = req.body as { parent_path?: unknown; name?: unknown };
        if (typeof name !== "string") {
            throw {
                status: 400,
                message: "name is required"
            };
        }
        if (!authReq.file?.path) {
            throw {
                status: 400,
                message: "file is required"
            };
        }
        try {
            const node = uploadFileFromTempPath(slug, typeof parent_path === "string" ? parent_path : "", name, authReq.file.path);
            res.json({ node });
        } finally {
            if (fs.existsSync(authReq.file.path)) {
                fs.unlinkSync(authReq.file.path);
            }
        }
    }, true));

    router.patch("/:slug/files/rename", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanEdit(slug, authReq.userId!);
        const { path, new_name } = req.body as { path?: unknown; new_name?: unknown };
        if (typeof path !== "string" || typeof new_name !== "string") {
            throw {
                status: 400,
                message: "path and new_name are required"
            };
        }
        const result = renamePath(slug, path, new_name);
        res.json(result);
    }, true));

    router.delete("/:slug/files", apiHandler(async (req, res) => {
        const slug = req.params.slug as string;
        const authReq = req as AuthenticatedRequest;
        await assertCanEdit(slug, authReq.userId!);
        const rawPath = typeof req.query.path === "string" ? req.query.path : undefined;
        deletePath(slug, rawPath);
        res.json({ success: true });
    }, true));
}
