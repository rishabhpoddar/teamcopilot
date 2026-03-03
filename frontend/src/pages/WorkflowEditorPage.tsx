import { AxiosError } from 'axios';
import { type ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { toast } from 'react-toastify';
import MonacoEditor from '../components/workflow-editor/MonacoEditor';
import { useAuth } from '../lib/auth';
import { axiosInstance, axiosUploadInstance } from '../utils';
import type {
    WorkflowEditorAccessResponse,
    WorkflowFileContentResponse,
    WorkflowFileNode,
} from '../types/workflow-files';
import './WorkflowEditorPage.css';

type EditorEntity = 'workflow' | 'skill';
type DirectoryChildrenMap = Record<string, WorkflowFileNode[]>;

type WorkflowDetails = {
    slug: string;
    name: string;
    created_by_user_name: string | null;
    created_by_user_email: string | null;
    approved_by_user_id: string | null;
    approved_by_user_name: string | null;
    approved_by_user_email: string | null;
    run_permission_mode: 'restricted' | 'everyone';
    allowed_runner_count: number;
    is_run_locked_due_to_missing_users: boolean;
};

type ActiveFileState =
    | {
        path: string;
        name: string;
        kind: 'text';
        content: string;
        savedContent: string;
        etag: string;
        isDotenv: boolean;
        modifiedAtMs: number;
        sizeBytes: number;
    }
    | {
        path: string;
        name: string;
        kind: 'binary';
        message: string;
        etag: string;
        modifiedAtMs: number;
        sizeBytes: number;
    }
    | {
        path: string;
        name: string;
        kind: 'loading';
    };

function getErrorMessage(err: unknown, fallback: string): string {
    return err instanceof AxiosError ? String(err.response?.data?.message || err.response?.data || err.message) : fallback;
}

function getParentPath(filePath: string): string {
    const idx = filePath.lastIndexOf('/');
    return idx === -1 ? '' : filePath.slice(0, idx);
}

function getBaseName(filePath: string): string {
    const idx = filePath.lastIndexOf('/');
    return idx === -1 ? filePath : filePath.slice(idx + 1);
}

function isPathInside(path: string, maybeParent: string): boolean {
    return path === maybeParent || path.startsWith(`${maybeParent}/`);
}

function extension(fileName: string): string {
    const idx = fileName.lastIndexOf('.');
    return idx === -1 ? '' : fileName.slice(idx + 1).toLowerCase();
}

function languageForPath(filePath: string): string {
    const base = getBaseName(filePath).toLowerCase();
    if (base === '.env') return 'shell';
    const ext = extension(filePath);
    if (ext === 'ts' || ext === 'tsx') return 'typescript';
    if (ext === 'js' || ext === 'jsx' || ext === 'mjs' || ext === 'cjs') return 'javascript';
    if (ext === 'json') return 'json';
    if (ext === 'py') return 'python';
    if (ext === 'md') return 'markdown';
    if (ext === 'yml' || ext === 'yaml') return 'yaml';
    if (ext === 'sh' || ext === 'bash') return 'shell';
    if (ext === 'css') return 'css';
    if (ext === 'html') return 'html';
    if (ext === 'xml') return 'xml';
    if (ext === 'txt' || ext === 'log') return 'plaintext';
    return 'plaintext';
}

function formatDateTime(ms: number): string {
    return new Date(ms).toLocaleString();
}

function displayUser(name: string | null, email: string | null): string {
    if (name && email) return `${name} (${email})`;
    if (name) return name;
    if (email) return email;
    return 'Unknown';
}

export default function WorkflowEditorPage({ entity = 'workflow' }: { entity?: EditorEntity }) {
    const { slug = '' } = useParams();
    const navigate = useNavigate();
    const auth = useAuth();
    const apiBase = entity === 'workflow' ? '/api/workflows' : '/api/skills';
    const entityLabel = entity === 'workflow' ? 'workflow' : 'skill';
    const backTab = entity === 'workflow' ? 'workflows' : 'skills';
    const infoTitle = entity === 'workflow' ? 'Workflow Info' : 'Skill Info';
    const explorerCaption = entity === 'workflow' ? 'Workflow project explorer' : 'Skill project explorer';

    const token = auth.loading ? null : auth.token;

    const [pageLoading, setPageLoading] = useState(true);
    const [pageError, setPageError] = useState<string | null>(null);
    const [workflowTitle, setWorkflowTitle] = useState<string>(slug);
    const [workflowDetails, setWorkflowDetails] = useState<WorkflowDetails | null>(null);
    const [access, setAccess] = useState<WorkflowEditorAccessResponse | null>(null);

    const [childrenByDir, setChildrenByDir] = useState<DirectoryChildrenMap>({});
    const [expandedDirs, setExpandedDirs] = useState<Record<string, boolean>>({ '': true });
    const [loadingDirs, setLoadingDirs] = useState<Record<string, boolean>>({});
    const [dirErrors, setDirErrors] = useState<Record<string, string>>({});

    const [selectedPath, setSelectedPath] = useState<string | null>(null);
    const [activeFile, setActiveFile] = useState<ActiveFileState | null>(null);
    const [uploadTargetDir, setUploadTargetDir] = useState<string>('');
    const [uploadingByDir, setUploadingByDir] = useState<Record<string, boolean>>({});
    const [uploadProgressByDir, setUploadProgressByDir] = useState<Record<string, { fileName: string; percent: number }>>({});
    const uploadInputRef = useRef<HTMLInputElement | null>(null);

    const canEdit = access?.can_edit ?? false;
    const activeTextFile = activeFile?.kind === 'text' ? activeFile : null;
    const isDirty = Boolean(activeTextFile && activeTextFile.content !== activeTextFile.savedContent);

    const rootEntries = childrenByDir[''] ?? [];

    const authHeader = useMemo(() => token ? { Authorization: `Bearer ${token}` } : undefined, [token]);

    const refreshDir = useCallback(async (dirPath: string) => {
        if (!authHeader) return;
        setLoadingDirs((prev) => ({ ...prev, [dirPath]: true }));
        setDirErrors((prev) => ({ ...prev, [dirPath]: '' }));
        try {
            const response = await axiosInstance.get(`${apiBase}/` + encodeURIComponent(slug) + '/files/tree', {
                params: dirPath ? { path: dirPath } : {},
                headers: authHeader
            });
            setChildrenByDir((prev) => ({ ...prev, [dirPath]: response.data.entries as WorkflowFileNode[] }));
        } catch (err: unknown) {
            const message = getErrorMessage(err, 'Failed to load files');
            setDirErrors((prev) => ({ ...prev, [dirPath]: message }));
            if (dirPath === '') {
                setPageError(message);
            }
        } finally {
            setLoadingDirs((prev) => ({ ...prev, [dirPath]: false }));
        }
    }, [apiBase, authHeader, slug]);

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        setPageLoading(true);
        setPageError(null);
        void (async () => {
            try {
                const [accessResponse, workflowResponse] = await Promise.all([
                    axiosInstance.get(`${apiBase}/${encodeURIComponent(slug)}/files/access`, { headers: authHeader }),
                    axiosInstance.get(`${apiBase}/${encodeURIComponent(slug)}`, { headers: authHeader }),
                ]);
                if (cancelled) return;
                setAccess(accessResponse.data as WorkflowEditorAccessResponse);
                const workflow = workflowResponse.data.workflow as WorkflowDetails;
                setWorkflowDetails(workflow);
                setWorkflowTitle(workflow.name || workflow.slug);
                await refreshDir('');
            } catch (err: unknown) {
                if (cancelled) return;
                setPageError(getErrorMessage(err, `Failed to load ${entityLabel} editor`));
            } finally {
                if (!cancelled) {
                    setPageLoading(false);
                }
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [apiBase, authHeader, entityLabel, refreshDir, slug, token]);

    useEffect(() => {
        const onBeforeUnload = (event: BeforeUnloadEvent) => {
            if (!isDirty) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => window.removeEventListener('beforeunload', onBeforeUnload);
    }, [isDirty]);

    const confirmDiscardIfNeeded = (): boolean => {
        if (!isDirty) return true;
        return window.confirm('You have unsaved changes. Discard them?');
    };

    const handleBack = () => {
        if (!confirmDiscardIfNeeded()) return;
        navigate(`/?tab=${backTab}`);
    };

    const handleToggleDirectory = async (node: WorkflowFileNode) => {
        if (node.kind !== 'directory') return;
        const nextExpanded = !expandedDirs[node.path];
        setExpandedDirs((prev) => ({ ...prev, [node.path]: nextExpanded }));
        if (nextExpanded && childrenByDir[node.path] === undefined) {
            await refreshDir(node.path);
        }
    };

    const openFile = async (node: WorkflowFileNode) => {
        if (node.kind !== 'file') return;
        if (!confirmDiscardIfNeeded()) return;

        setSelectedPath(node.path);
        setActiveFile({ path: node.path, name: node.name, kind: 'loading' });
        try {
            const response = await axiosInstance.get(`${apiBase}/${encodeURIComponent(slug)}/files/content`, {
                params: { path: node.path },
                headers: authHeader
            });
            const data = response.data as WorkflowFileContentResponse;
            if (data.kind === 'binary') {
                setActiveFile({
                    path: data.path,
                    name: data.name,
                    kind: 'binary',
                    message: data.message,
                    etag: data.etag,
                    modifiedAtMs: data.modified_at_ms,
                    sizeBytes: data.size_bytes,
                });
                return;
            }
            setActiveFile({
                path: data.path,
                name: data.name,
                kind: 'text',
                content: data.content,
                savedContent: data.content,
                etag: data.etag,
                isDotenv: data.name === '.env',
                modifiedAtMs: data.modified_at_ms,
                sizeBytes: data.size_bytes,
            });
        } catch (err: unknown) {
            setActiveFile(null);
            setPageError(getErrorMessage(err, 'Failed to open file'));
        }
    };

    const handleSaveActiveFile = useCallback(async () => {
        if (!activeTextFile || !authHeader || !canEdit) return;
        try {
            const response = await axiosInstance.put(`${apiBase}/${encodeURIComponent(slug)}/files/content`, {
                path: activeTextFile.path,
                content: activeTextFile.content,
                base_etag: activeTextFile.etag,
            }, {
                headers: authHeader
            });
            const result = response.data as { etag: string; modified_at_ms: number; size_bytes: number };
            setActiveFile((prev) => {
                if (!prev || prev.kind !== 'text' || prev.path !== activeTextFile.path) return prev;
                return {
                    ...prev,
                    etag: result.etag,
                    modifiedAtMs: result.modified_at_ms,
                    sizeBytes: result.size_bytes,
                    savedContent: prev.content,
                };
            });
            toast.success(`Saved ${activeTextFile.name}`);
            await refreshDir(getParentPath(activeTextFile.path));
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to save file'));
        }
    }, [activeTextFile, apiBase, authHeader, canEdit, slug, refreshDir]);

    useEffect(() => {
        const onKeydown = (event: KeyboardEvent) => {
            if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 's') {
                return;
            }
            if (!activeTextFile || !isDirty || !canEdit) {
                return;
            }
            event.preventDefault();
            void handleSaveActiveFile();
        };
        window.addEventListener('keydown', onKeydown);
        return () => window.removeEventListener('keydown', onKeydown);
    }, [activeTextFile, isDirty, canEdit, handleSaveActiveFile]);

    const handleCreate = async (parentPath: string, kind: 'file' | 'directory') => {
        if (!authHeader || !canEdit) return;
        const name = window.prompt(kind === 'file' ? 'New file name' : 'New folder name');
        if (!name) return;
        try {
            await axiosInstance.post(`${apiBase}/${encodeURIComponent(slug)}/files`, {
                parent_path: parentPath,
                name,
                kind
            }, {
                headers: authHeader
            });
            setExpandedDirs((prev) => ({ ...prev, [parentPath]: true }));
            await refreshDir(parentPath);
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, `Failed to create ${kind}`));
        }
    };

    const handleRename = async (node: WorkflowFileNode) => {
        if (!authHeader || !canEdit) return;
        const newName = window.prompt('Rename to', node.name);
        if (!newName || newName === node.name) return;
        try {
            const response = await axiosInstance.patch(`${apiBase}/${encodeURIComponent(slug)}/files/rename`, {
                path: node.path,
                new_name: newName
            }, {
                headers: authHeader
            });
            const result = response.data as { old_path: string; new_path: string };
            const oldPath = result.old_path;
            const newPath = result.new_path;

            setChildrenByDir((prev) => {
                const next: DirectoryChildrenMap = {};
                for (const [dir, entries] of Object.entries(prev)) {
                    const nextDirKey = isPathInside(dir, oldPath) ? dir.replace(oldPath, newPath) : dir;
                    next[nextDirKey] = entries.map((entry) => {
                        if (entry.path === oldPath || entry.path.startsWith(`${oldPath}/`)) {
                            return {
                                ...entry,
                                path: entry.path.replace(oldPath, newPath),
                                name: entry.path === oldPath ? getBaseName(newPath) : entry.name
                            };
                        }
                        return entry;
                    });
                }
                return next;
            });

            setExpandedDirs((prev) => {
                const next: Record<string, boolean> = {};
                for (const [dir, expanded] of Object.entries(prev)) {
                    const nextKey = isPathInside(dir, oldPath) ? dir.replace(oldPath, newPath) : dir;
                    next[nextKey] = expanded;
                }
                return next;
            });

            setSelectedPath((prev) => prev && (prev === oldPath || prev.startsWith(`${oldPath}/`)) ? prev.replace(oldPath, newPath) : prev);
            setActiveFile((prev) => {
                if (!prev) return prev;
                if (prev.path !== oldPath && !prev.path.startsWith(`${oldPath}/`)) return prev;
                return {
                    ...prev,
                    path: prev.path.replace(oldPath, newPath),
                    name: prev.path === oldPath ? getBaseName(newPath) : prev.name
                } as ActiveFileState;
            });

            await refreshDir(getParentPath(newPath));
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to rename'));
        }
    };

    const handleDelete = async (node: WorkflowFileNode) => {
        if (!authHeader || !canEdit) return;
        const confirmed = window.confirm(`Delete ${node.kind} "${node.name}"? This cannot be undone.`);
        if (!confirmed) return;
        try {
            await axiosInstance.delete(`${apiBase}/${encodeURIComponent(slug)}/files`, {
                params: { path: node.path },
                headers: authHeader
            });
            const parentPath = getParentPath(node.path);
            await refreshDir(parentPath);
            if (selectedPath && isPathInside(selectedPath, node.path)) {
                setSelectedPath(null);
            }
            if (activeFile && isPathInside(activeFile.path, node.path)) {
                setActiveFile(null);
            }
            setChildrenByDir((prev) => {
                const next: DirectoryChildrenMap = {};
                for (const [dir, entries] of Object.entries(prev)) {
                    if (isPathInside(dir, node.path)) continue;
                    next[dir] = entries.filter((entry) => !isPathInside(entry.path, node.path));
                }
                return next;
            });
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to delete'));
        }
    };

    const handleTriggerUpload = (dirPath: string) => {
        if (!canEdit) return;
        setUploadTargetDir(dirPath);
        uploadInputRef.current?.click();
    };

    const handleUploadSelectedFiles = async (event: ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file || !authHeader || !canEdit) return;
        const targetDir = uploadTargetDir;
        setUploadingByDir((prev) => ({ ...prev, [targetDir]: true }));
        setUploadProgressByDir((prev) => ({ ...prev, [targetDir]: { fileName: file.name, percent: 0 } }));
        try {
            const formData = new FormData();
            formData.append('parent_path', targetDir);
            formData.append('name', file.name);
            formData.append('file', file, file.name);
            await axiosUploadInstance.post(`${apiBase}/${encodeURIComponent(slug)}/files/upload`, formData, {
                headers: authHeader,
                onUploadProgress: (progressEvent) => {
                    const total = progressEvent.total ?? file.size;
                    if (!total) return;
                    const percent = Math.min(100, Math.round((progressEvent.loaded / total) * 100));
                    setUploadProgressByDir((prev) => ({ ...prev, [targetDir]: { fileName: file.name, percent } }));
                }
            });
            setExpandedDirs((prev) => ({ ...prev, [targetDir]: true }));
            await refreshDir(targetDir);
            setUploadProgressByDir((prev) => ({ ...prev, [targetDir]: { fileName: file.name, percent: 100 } }));
            toast.success(`Uploaded ${file.name}`);
        } catch (err: unknown) {
            toast.error(getErrorMessage(err, 'Failed to upload file'));
        } finally {
            setUploadingByDir((prev) => ({ ...prev, [targetDir]: false }));
            setUploadProgressByDir((prev) => {
                const next = { ...prev };
                delete next[targetDir];
                return next;
            });
            setUploadTargetDir('');
            event.currentTarget.value = '';
        }
    };

    const renderTree = (entries: WorkflowFileNode[], depth: number) => {
        return entries.map((node) => {
            const isExpanded = node.kind === 'directory' && Boolean(expandedDirs[node.path]);
            const isSelected = selectedPath === node.path;
            const children = childrenByDir[node.path] ?? [];
            const dirLoading = loadingDirs[node.path];
            const dirError = dirErrors[node.path];
            const dirUploading = uploadingByDir[node.path];
            const dirUploadProgress = uploadProgressByDir[node.path];

            return (
                <div key={node.path} className="wf-tree-row-wrap">
                    <div
                        className={`wf-tree-row ${isSelected ? 'selected' : ''}`}
                        style={{ paddingLeft: `${8 + depth * 16}px` }}
                        onClick={() => {
                            if (node.kind === 'directory') {
                                void handleToggleDirectory(node);
                            } else {
                                void openFile(node);
                            }
                        }}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                            if (e.key !== 'Enter' && e.key !== ' ') return;
                            e.preventDefault();
                            if (node.kind === 'directory') {
                                void handleToggleDirectory(node);
                            } else {
                                void openFile(node);
                            }
                        }}
                    >
                        <span className="wf-tree-chevron">
                            {node.kind === 'directory' ? (isExpanded ? '▾' : '▸') : ''}
                        </span>
                        <span className={`wf-tree-icon ${node.kind}`}>
                            {node.kind === 'directory' ? (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M1.75 3C1.75 2.30964 2.30964 1.75 3 1.75H6.08579C6.351 1.75 6.60536 1.85536 6.79289 2.04289L8.25 3.5H13C13.6904 3.5 14.25 4.05964 14.25 4.75V13C14.25 13.6904 13.6904 14.25 13 14.25H3C2.30964 14.25 1.75 13.6904 1.75 13V3Z" fill="currentColor" fillOpacity="0.3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            ) : (
                                <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                                    <path d="M3.75 2.75C3.75 2.19772 4.19772 1.75 4.75 1.75H9.08579C9.351 1.75 9.60536 1.85536 9.79289 2.04289L12.9571 5.20711C13.1446 5.39464 13.25 5.649 13.25 5.91421V13.25C13.25 13.8023 12.8023 14.25 12.25 14.25H4.75C4.19772 14.25 3.75 13.8023 3.75 13.25V2.75Z" fill="currentColor" fillOpacity="0.1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                    <path d="M9.25 2V5.25C9.25 5.66421 9.58579 6 10 6H13" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                                </svg>
                            )}
                        </span>
                        <span className="wf-tree-name">{node.name}</span>
                        {!node.readable && <span className="wf-tree-badge">no-read</span>}
                        {canEdit && (
                            <span className="wf-tree-actions" onClick={(e) => e.stopPropagation()}>
                                {node.kind === 'directory' && (
                                    <>
                                        <button type="button" onClick={() => void handleCreate(node.path, 'file')} title="New file">+F</button>
                                        <button type="button" onClick={() => void handleCreate(node.path, 'directory')} title="New folder">+D</button>
                                        <button type="button" onClick={() => handleTriggerUpload(node.path)} title="Upload files">Upload</button>
                                    </>
                                )}
                                <button type="button" onClick={() => void handleRename(node)} title="Rename">Rename</button>
                                <button type="button" onClick={() => void handleDelete(node)} title="Delete">Delete</button>
                            </span>
                        )}
                    </div>
                    {node.kind === 'directory' && isExpanded && (
                        <div>
                            {dirLoading && <div className="wf-tree-note" style={{ paddingLeft: `${24 + depth * 16}px` }}>Loading...</div>}
                            {dirUploading && dirUploadProgress && (
                                <div className="wf-tree-note" style={{ paddingLeft: `${24 + depth * 16}px` }}>
                                    Uploading {dirUploadProgress.fileName}... {dirUploadProgress.percent}%
                                </div>
                            )}
                            {dirError && <div className="wf-tree-note error" style={{ paddingLeft: `${24 + depth * 16}px` }}>{dirError}</div>}
                            {!dirLoading && !dirError && children.length > 0 && renderTree(children, depth + 1)}
                            {!dirLoading && !dirError && children.length === 0 && (
                                <div className="wf-tree-note" style={{ paddingLeft: `${24 + depth * 16}px` }}>Empty</div>
                            )}
                        </div>
                    )}
                </div>
            );
        });
    };

    if (auth.loading) return null;

    const permissionSummaryText = workflowDetails
        ? workflowDetails.run_permission_mode === 'everyone'
            ? 'Everyone can run'
            : workflowDetails.is_run_locked_due_to_missing_users
                ? 'Restricted (locked: no allowed users remain)'
                : `Restricted (${workflowDetails.allowed_runner_count} allowed)`
        : null;

    return (
        <div className="workflow-editor-page">
            <header className="workflow-editor-header">
                <div className="workflow-editor-header-left">
                    <button type="button" className="secondary" onClick={handleBack}>Back</button>
                    <div>
                        <h1>{workflowTitle}</h1>
                        {access && (
                            <p className="workflow-editor-subtitle">
                                {slug} · {access.workflow_status} · {canEdit ? 'Editable' : 'Read only'}
                            </p>
                        )}
                    </div>
                </div>
                <div className="workflow-editor-header-right">
                    {activeTextFile && (
                        <span className={`wf-save-status ${isDirty ? 'dirty' : 'saved'}`}>
                            {isDirty ? 'Unsaved changes' : 'Saved'}
                        </span>
                    )}
                    <button
                        type="button"
                        onClick={() => void handleSaveActiveFile()}
                        disabled={!activeTextFile || !isDirty || !canEdit}
                    >
                        Save
                    </button>
                </div>
            </header>

            {pageLoading ? (
                <div className="workflow-editor-loading">Loading {entityLabel} editor...</div>
            ) : pageError ? (
                <div className="workflow-editor-error">{pageError}</div>
            ) : (
                <div className="workflow-editor-layout">
                    <aside className="workflow-editor-sidebar">
                        {workflowDetails && (
                            <div className="wf-workflow-meta-card">
                                <div className="wf-workflow-meta-title">{infoTitle}</div>
                                <div className="wf-workflow-meta-grid">
                                    <div className="wf-workflow-meta-label">Status</div>
                                    <div className="wf-workflow-meta-value">
                                        {access?.workflow_status === 'approved' ? 'Approved' : 'Pending approval'}
                                    </div>

                                    <div className="wf-workflow-meta-label">Permissions</div>
                                    <div className="wf-workflow-meta-value">{permissionSummaryText}</div>

                                    <div className="wf-workflow-meta-label">Creator</div>
                                    <div className="wf-workflow-meta-value">
                                        {displayUser(workflowDetails.created_by_user_name, workflowDetails.created_by_user_email)}
                                    </div>

                                    <div className="wf-workflow-meta-label">Approver</div>
                                    <div className="wf-workflow-meta-value">
                                        {workflowDetails.approved_by_user_id
                                            ? displayUser(workflowDetails.approved_by_user_name, workflowDetails.approved_by_user_email)
                                            : 'Not approved yet'}
                                    </div>

                                </div>
                            </div>
                        )}
                        <div className="wf-sidebar-header">
                            <div>
                                <div className="wf-sidebar-title">Files</div>
                                <div className="wf-sidebar-caption">{explorerCaption}</div>
                            </div>
                            {canEdit && (
                                <div className="wf-sidebar-actions">
                                    <button type="button" onClick={() => void handleCreate('', 'file')}>New File</button>
                                    <button type="button" onClick={() => void handleCreate('', 'directory')}>New Folder</button>
                                    <button type="button" onClick={() => handleTriggerUpload('')}>Upload</button>
                                </div>
                            )}
                        </div>
                        <div className="wf-tree-scroll">
                            {loadingDirs[''] && rootEntries.length === 0 && <div className="wf-tree-note">Loading...</div>}
                            {uploadingByDir[''] && uploadProgressByDir[''] && (
                                <div className="wf-tree-note">
                                    Uploading {uploadProgressByDir[''].fileName}... {uploadProgressByDir[''].percent}%
                                </div>
                            )}
                            {dirErrors[''] && <div className="wf-tree-note error">{dirErrors['']}</div>}
                            {!loadingDirs[''] && !dirErrors[''] && rootEntries.length === 0 && <div className="wf-tree-note">No files found.</div>}
                            {renderTree(rootEntries, 0)}
                        </div>
                        {canEdit && (
                            <input
                                ref={uploadInputRef}
                                className="wf-hidden-upload-input"
                                type="file"
                                onChange={(event) => void handleUploadSelectedFiles(event)}
                            />
                        )}
                    </aside>

                    <section className="workflow-editor-main">
                        {!activeFile && (
                            <div className="wf-editor-empty">
                                <h2>Select a file</h2>
                                <p>Choose a file from the {entityLabel} explorer to view or edit it.</p>
                            </div>
                        )}

                        {activeFile?.kind === 'loading' && (
                            <div className="wf-editor-empty">
                                <h2>Loading file...</h2>
                            </div>
                        )}

                        {activeFile?.kind === 'binary' && (
                            <div className="wf-editor-panel">
                                <div className="wf-editor-toolbar">
                                    <div className="wf-editor-filemeta">
                                        <strong>{activeFile.name}</strong>
                                        <span>{activeFile.path}</span>
                                    </div>
                                </div>
                                <div className="wf-editor-empty">
                                    <h2>Binary file</h2>
                                    <p>{activeFile.message}</p>
                                    <p className="wf-editor-meta-line">
                                        Size: {activeFile.sizeBytes} bytes · Modified: {formatDateTime(activeFile.modifiedAtMs)}
                                    </p>
                                </div>
                            </div>
                        )}

                        {activeTextFile && (
                            <div className="wf-editor-panel">
                                <div className="wf-editor-toolbar">
                                    <div className="wf-editor-filemeta">
                                        <strong>{activeTextFile.name}</strong>
                                        <span>{activeTextFile.path}</span>
                                    </div>
                                    <div className="wf-editor-meta-right">
                                        <span>{activeTextFile.sizeBytes} bytes</span>
                                        <span>{formatDateTime(activeTextFile.modifiedAtMs)}</span>
                                        {activeTextFile.isDotenv && <span className="wf-dotenv-pill">.env redacted</span>}
                                    </div>
                                </div>
                                {activeTextFile.isDotenv && (
                                    <div className="wf-dotenv-warning">
                                        Redacted values are shown for `.env`. Saving preserves unchanged masked values and applies any edits you make.
                                    </div>
                                )}
                                <div className="wf-editor-surface">
                                    <MonacoEditor
                                        value={activeTextFile.content}
                                        language={languageForPath(activeTextFile.path)}
                                        readOnly={!canEdit}
                                        onChange={(nextValue) => {
                                            setActiveFile((prev) => {
                                                if (!prev || prev.kind !== 'text' || prev.path !== activeTextFile.path) return prev;
                                                return { ...prev, content: nextValue };
                                            });
                                        }}
                                    />
                                </div>
                            </div>
                        )}
                    </section>
                </div>
            )}
        </div>
    );
}
