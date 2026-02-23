import { useState } from 'react';
import { toast } from 'react-toastify';
import type { Workflow } from '../../types/workflow';
import { axiosInstance } from '../../utils';
import { AxiosError } from 'axios';

interface WorkflowCardProps extends Workflow {
    userRole: 'User' | 'Engineer';
    currentUserId: string | null;
    token: string;
    onApproved: () => void;
    onDeleted: () => void;
    onRunWorkflow: (workflowName: string) => void;
}

export default function WorkflowCard({
    slug,
    name,
    intent_summary,
    created_by_user_name,
    created_by_user_email,
    created_by_user_id,
    approved_by_user_id,
    run_permission_mode,
    can_current_user_run,
    can_current_user_manage_run_permissions,
    allowed_runner_count,
    is_run_locked_due_to_missing_users,
    userRole,
    currentUserId,
    token,
    onApproved,
    onDeleted,
    onRunWorkflow
}: WorkflowCardProps) {
    const [approving, setApproving] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [showPermissionsEditor, setShowPermissionsEditor] = useState(false);
    const [permissionsLoading, setPermissionsLoading] = useState(false);
    const [permissionsSaving, setPermissionsSaving] = useState(false);
    const [permissionsError, setPermissionsError] = useState<string | null>(null);
    const [allUsers, setAllUsers] = useState<Array<{ id: string; name: string; email: string; role: 'User' | 'Engineer' }>>([]);
    const [permissionMode, setPermissionMode] = useState<'restricted' | 'everyone'>('restricted');
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [ownerUserIdForEditor, setOwnerUserIdForEditor] = useState<string | null>(created_by_user_id);
    const [approverUserIdForEditor, setApproverUserIdForEditor] = useState<string | null>(approved_by_user_id);
    const isApproved = approved_by_user_id !== null;
    const canRun = isApproved && can_current_user_run;
    const canManagePermissions = isApproved && can_current_user_manage_run_permissions;
    const creatorUserMissing = created_by_user_id === null || (!created_by_user_name && !created_by_user_email);
    const canDelete = created_by_user_id === currentUserId || (userRole === 'Engineer' && creatorUserMissing);

    const loadPermissionsEditorData = async () => {
        setPermissionsLoading(true);
        setPermissionsError(null);
        try {
            const [workflowResponse, usersResponse] = await Promise.all([
                axiosInstance.get(`/api/workflows/${slug}`, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                axiosInstance.get('/api/workflows/users', {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);
            const workflow = workflowResponse.data.workflow as {
                created_by_user_id: string | null;
                approved_by_user_id: string | null;
                run_permissions: { mode: 'everyone' } | { mode: 'restricted'; allowed_user_ids: string[] };
            };
            setOwnerUserIdForEditor(workflow.created_by_user_id);
            setApproverUserIdForEditor(workflow.approved_by_user_id);
            setPermissionMode(workflow.run_permissions.mode);
            setSelectedUserIds(workflow.run_permissions.mode === 'restricted' ? workflow.run_permissions.allowed_user_ids : []);
            setAllUsers(usersResponse.data.users);
            setShowPermissionsEditor(true);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to load workflow permissions';
            setPermissionsError(String(errorMessage));
        } finally {
            setPermissionsLoading(false);
        }
    };

    const toggleAllowedUser = (userId: string) => {
        if (ownerUserIdForEditor === userId) {
            return;
        }
        setSelectedUserIds((prev) => prev.includes(userId) ? prev.filter((id) => id !== userId) : [...prev, userId]);
    };

    const handleSavePermissions = async () => {
        setPermissionsSaving(true);
        try {
            const payload = permissionMode === 'everyone'
                ? { mode: 'everyone' as const }
                : { mode: 'restricted' as const, allowed_user_ids: Array.from(new Set(selectedUserIds)) };
            await axiosInstance.patch(`/api/workflows/${slug}/run-permissions`, payload, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Workflow permissions updated');
            setShowPermissionsEditor(false);
            onApproved();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to update workflow permissions';
            toast.error(errorMessage);
        } finally {
            setPermissionsSaving(false);
        }
    };

    const handleApprove = async () => {
        setApproving(true);
        try {
            await axiosInstance.post(`/api/workflows/${slug}/approve`, {}, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Workflow approved successfully');
            onApproved();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data?.message || err.response?.data || err.message
                : 'Failed to approve workflow';
            toast.error(errorMessage);
        } finally {
            setApproving(false);
        }
    };

    const handleDelete = async () => {
        const confirmed = window.confirm(
            `Delete workflow "${name || slug}"?\n\nThis will permanently delete the workflow folder and all past runs. This cannot be undone.`
        );
        if (!confirmed) return;

        setDeleting(true);
        try {
            await axiosInstance.delete(`/api/workflows/${slug}`, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success('Workflow deleted successfully');
            onDeleted();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : 'Failed to delete workflow';
            toast.error(errorMessage);
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name}</h3>
                <span className={`workflow-approval-badge ${isApproved ? 'approved' : 'pending'}`}>
                    {isApproved ? 'Approved' : 'Pending Approval'}
                </span>
            </div>
            {intent_summary && <p className="workflow-card-description">{intent_summary}</p>}
            <p className="workflow-card-meta">
                Created by: {created_by_user_name ?? created_by_user_email ?? 'Unknown User'}
            </p>

            {!isApproved && (
                <div className="workflow-approval-section">
                    {userRole === 'Engineer' ? (
                        <button
                            className="workflow-approve-btn"
                            onClick={handleApprove}
                            disabled={approving}
                        >
                            {approving ? 'Approving...' : 'Approve Workflow'}
                        </button>
                    ) : (
                        <p className="workflow-approval-message">
                            Ask an engineer to approve this workflow before it can be run.
                        </p>
                    )}
                </div>
            )}

            {isApproved && (
                <div className="workflow-approval-section">
                    <p className="workflow-approval-message">
                        {run_permission_mode === 'everyone'
                            ? 'Run access: Everyone'
                            : is_run_locked_due_to_missing_users
                                ? 'Run access: Restricted (locked - no allowed users remain)'
                                : can_current_user_run
                                    ? `Run access: Restricted (${allowed_runner_count} allowed)`
                                    : 'Run access: Restricted'}
                    </p>
                    {permissionsError && !showPermissionsEditor && (
                        <p className="workflow-approval-message">{permissionsError}</p>
                    )}
                    {permissionsLoading && <p className="workflow-approval-message">Loading permissions...</p>}
                    <button
                        className="workflow-approve-btn"
                        onClick={loadPermissionsEditorData}
                        disabled={!canManagePermissions || permissionsLoading}
                        type="button"
                    >
                        Manage Permissions
                    </button>
                    {!canManagePermissions && (
                        <p className="workflow-approval-message">
                            {is_run_locked_due_to_missing_users
                                ? 'No one can modify permissions because no allowed users remain.'
                                : 'Only users who can run this workflow can change permissions.'}
                        </p>
                    )}
                    {showPermissionsEditor && (
                        <div className="permissions-editor">
                            <div className="permissions-editor-header">
                                <h4 className="permissions-editor-title">Manage Run Permissions</h4>
                                <div className="permissions-mode-group">
                                    <label className="permissions-mode-label" htmlFor="permission-mode-select">
                                        Permission Mode
                                    </label>
                                    <select
                                        id="permission-mode-select"
                                        className="permissions-mode-select"
                                        value={permissionMode}
                                        onChange={(e) => setPermissionMode(e.target.value as 'restricted' | 'everyone')}
                                    >
                                        <option value="restricted">Restricted (Specific Users)</option>
                                        <option value="everyone">Everyone</option>
                                    </select>
                                </div>
                            </div>

                            {permissionMode === 'restricted' && (
                                <div className="permissions-users-section">
                                    <div className="permissions-users-title">Allowed Users</div>
                                    <div className="permissions-users-list">
                                        {allUsers.map((user) => {
                                            const checked = selectedUserIds.includes(user.id);
                                            const isOwner = ownerUserIdForEditor === user.id;
                                            const isApprover = approverUserIdForEditor === user.id;
                                            return (
                                                <div
                                                    key={user.id}
                                                    className={`permissions-user-item ${isOwner ? 'permissions-user-item-disabled' : ''}`}
                                                    onClick={() => !isOwner && toggleAllowedUser(user.id)}
                                                >
                                                    <input
                                                        type="checkbox"
                                                        className="permissions-user-checkbox"
                                                        checked={checked}
                                                        disabled={isOwner}
                                                        onChange={() => toggleAllowedUser(user.id)}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                    <div className="permissions-user-info">
                                                        <div className="permissions-user-name">{user.name}</div>
                                                        <div className="permissions-user-email">{user.email}</div>
                                                    </div>
                                                    {(isOwner || isApprover) && (
                                                        <div className="permissions-user-badges">
                                                            {isOwner && (
                                                                <span className="permissions-user-badge permissions-user-badge-owner">
                                                                    Owner
                                                                </span>
                                                            )}
                                                            {isApprover && (
                                                                <span className="permissions-user-badge permissions-user-badge-approver">
                                                                    Approver
                                                                </span>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            <div className="permissions-editor-actions">
                                <button
                                    type="button"
                                    className="permissions-editor-save-btn"
                                    onClick={handleSavePermissions}
                                    disabled={permissionsSaving}
                                >
                                    {permissionsSaving ? 'Saving...' : 'Save Permissions'}
                                </button>
                                <button
                                    type="button"
                                    className="permissions-editor-cancel-btn"
                                    onClick={() => setShowPermissionsEditor(false)}
                                    disabled={permissionsSaving}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <div className="workflow-card-actions">
                <button
                    className="workflow-card-run-btn"
                    disabled={!canRun}
                    onClick={() => onRunWorkflow(name || slug)}
                >
                    Run Workflow
                </button>

                {canDelete && (
                    <button
                        className="workflow-card-delete-btn"
                        onClick={handleDelete}
                        disabled={deleting}
                    >
                        {deleting ? 'Deleting...' : 'Delete'}
                    </button>
                )}
            </div>
        </div>
    );
}
