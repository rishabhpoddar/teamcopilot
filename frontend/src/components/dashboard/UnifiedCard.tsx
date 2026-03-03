import { useState } from 'react';
import { AxiosError } from 'axios';
import { toast } from 'react-toastify';
import { axiosInstance } from '../../utils';
import CardActions from './CardActions';

type PermissionMode = 'restricted' | 'everyone';
type EntityKind = 'workflow' | 'skill';

interface UnifiedCardProps {
    kind: EntityKind;
    slug: string;
    name: string;
    description: string;
    created_by_user_id: string | null;
    created_by_user_name: string | null;
    created_by_user_email: string | null;
    approved_by_user_id: string | null;
    is_approved: boolean;
    can_view: boolean;
    can_edit: boolean;
    permission_mode: PermissionMode;
    is_locked_due_to_missing_users: boolean;
    can_run: boolean;
    userRole: 'User' | 'Engineer';
    currentUserId: string | null;
    token: string;
    viewLabel: string;
    showRunAction: boolean;
    runLabel: string;
    onUpdated: () => void;
    onDeleted: () => void;
    onOpen: (slug: string) => void;
    onRunAi?: () => void;
    onRunManual?: () => void;
}

export default function UnifiedCard({
    kind,
    slug,
    name,
    description,
    created_by_user_id,
    created_by_user_name,
    created_by_user_email,
    approved_by_user_id,
    is_approved,
    can_edit,
    permission_mode,
    is_locked_due_to_missing_users,
    can_run,
    userRole,
    currentUserId,
    token,
    viewLabel,
    showRunAction,
    runLabel,
    onUpdated,
    onDeleted,
    onOpen,
    onRunAi,
    onRunManual,
}: UnifiedCardProps) {
    const [deleting, setDeleting] = useState(false);
    const [showPermissionsEditor, setShowPermissionsEditor] = useState(false);
    const [permissionsLoading, setPermissionsLoading] = useState(false);
    const [permissionsSaving, setPermissionsSaving] = useState(false);
    const [permissionsError, setPermissionsError] = useState<string | null>(null);
    const [allUsers, setAllUsers] = useState<Array<{ id: string; name: string; email: string; role: 'User' | 'Engineer' }>>([]);
    const [permissionMode, setPermissionMode] = useState<PermissionMode>('restricted');
    const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
    const [ownerUserIdForEditor, setOwnerUserIdForEditor] = useState<string | null>(created_by_user_id);
    const [approverUserIdForEditor, setApproverUserIdForEditor] = useState<string | null>(approved_by_user_id);

    const creatorUserMissing = created_by_user_id === null || (!created_by_user_name && !created_by_user_email);
    const canDelete = created_by_user_id === currentUserId || (userRole === 'Engineer' && creatorUserMissing);
    const canManagePermissions = is_approved && can_edit;
    const accessLabel = kind === 'workflow' ? 'Run access' : 'Access';
    const managePermissionsTitle = kind === 'workflow' ? 'Manage Run Permissions' : 'Manage Access Permissions';

    const resourceLabel = kind === 'workflow' ? 'workflow' : 'skill';
    const resourceLabelTitle = kind === 'workflow' ? 'Workflow' : 'Skill';
    const detailUrl = `/api/${kind === 'workflow' ? 'workflows' : 'skills'}/${slug}`;
    const usersUrl = '/api/users';
    const updatePermissionsUrl = `/api/${kind === 'workflow' ? 'workflows' : 'skills'}/${slug}/permissions`;

    const loadPermissionsEditorData = async () => {
        setPermissionsLoading(true);
        setPermissionsError(null);
        try {
            const [detailResponse, usersResponse] = await Promise.all([
                axiosInstance.get(detailUrl, {
                    headers: { Authorization: `Bearer ${token}` }
                }),
                axiosInstance.get(usersUrl, {
                    headers: { Authorization: `Bearer ${token}` }
                })
            ]);

            const detail = (detailResponse.data.workflow ?? detailResponse.data.skill) as {
                created_by_user_id: string | null;
                approved_by_user_id: string | null;
                permissions?: { mode: 'everyone' } | { mode: 'restricted'; allowed_user_ids: string[] };
            };

            const permissions = detail.permissions;
            if (!permissions) {
                throw new Error('Missing permissions in response');
            }

            setOwnerUserIdForEditor(detail.created_by_user_id);
            setApproverUserIdForEditor(detail.approved_by_user_id);
            setPermissionMode(permissions.mode);
            setSelectedUserIds(permissions.mode === 'restricted' ? permissions.allowed_user_ids : []);
            setAllUsers(usersResponse.data.users);
            setShowPermissionsEditor(true);
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : `Failed to load ${resourceLabel} permissions`;
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
            await axiosInstance.patch(updatePermissionsUrl, payload, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success(`${resourceLabelTitle} permissions updated`);
            setShowPermissionsEditor(false);
            onUpdated();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : `Failed to update ${resourceLabel} permissions`;
            toast.error(String(errorMessage));
        } finally {
            setPermissionsSaving(false);
        }
    };

    const openApprovalReview = () => {
        const url = kind === 'workflow'
            ? `/workflows/${encodeURIComponent(slug)}/approval-review`
            : `/skills/${encodeURIComponent(slug)}/approval-review`;
        window.open(url, '_blank', 'noopener,noreferrer');
    };

    const handleDelete = async () => {
        const confirmed = window.confirm(
            `Delete ${resourceLabel} "${name || slug}"?\n\nThis will permanently delete the ${resourceLabel} folder${kind === 'workflow' ? ' and all past runs' : ''}. This cannot be undone.`
        );
        if (!confirmed) return;

        setDeleting(true);
        try {
            await axiosInstance.delete(detailUrl, {
                headers: { Authorization: `Bearer ${token}` }
            });
            toast.success(`${resourceLabelTitle} deleted successfully`);
            onDeleted();
        } catch (err: unknown) {
            const errorMessage = err instanceof AxiosError
                ? err.response?.data?.message || err.response?.data || err.message
                : `Failed to delete ${resourceLabel}`;
            toast.error(String(errorMessage));
        } finally {
            setDeleting(false);
        }
    };

    return (
        <div className="workflow-card">
            <div className="workflow-card-header">
                <h3 className="workflow-card-title">{name}</h3>
                <span className={`workflow-approval-badge ${is_approved ? 'approved' : 'pending'}`}>
                    {is_approved ? 'Approved' : 'Pending Approval'}
                </span>
            </div>
            {kind === 'skill'
                ? <p className="workflow-card-description">{description.trim() || 'No description available'}</p>
                : description && <p className="workflow-card-description">{description}</p>}
            <p className="workflow-card-meta">
                Created by: {created_by_user_name ?? created_by_user_email ?? 'Unknown User'}
            </p>

            {!is_approved && (
                <div className="workflow-approval-section">
                    {userRole === 'Engineer' ? (
                        <button
                            className="workflow-approve-btn"
                            onClick={() => {
                                openApprovalReview();
                            }}
                        >
                            Review & Approve
                        </button>
                    ) : (
                        <p className="workflow-approval-message">
                            Ask an engineer to approve this {resourceLabel} before it can be used.
                        </p>
                    )}
                </div>
            )}

            {is_approved && (
                <div className="workflow-approval-section">
                        <p className="workflow-approval-message">
                            {permission_mode === 'everyone'
                                ? `${accessLabel}: Everyone`
                                : is_locked_due_to_missing_users
                                    ? `${accessLabel}: Restricted (locked - no allowed users remain)`
                                    : `${accessLabel}: Restricted`}
                        </p>
                    {permissionsError && !showPermissionsEditor && (
                        <p className="workflow-approval-message">{permissionsError}</p>
                    )}
                    {permissionsLoading && <p className="workflow-approval-message">Loading permissions...</p>}
                    <button
                        className="workflow-approve-btn"
                        onClick={() => {
                            void loadPermissionsEditorData();
                        }}
                        disabled={!canManagePermissions || permissionsLoading}
                        type="button"
                    >
                        Manage Permissions
                    </button>
                    {!canManagePermissions && (
                        <p className="workflow-approval-message">
                            {is_locked_due_to_missing_users
                                ? 'No one can modify permissions because no allowed users remain.'
                                : `Only users who can use this ${resourceLabel} can change permissions.`}
                        </p>
                    )}
                    {showPermissionsEditor && (
                        <div className="permissions-editor">
                            <div className="permissions-editor-header">
                                <h4 className="permissions-editor-title">{managePermissionsTitle}</h4>
                                <div className="permissions-mode-group">
                                    <label className="permissions-mode-label" htmlFor={`permission-mode-select-${slug}`}>
                                        Permission Mode
                                    </label>
                                    <select
                                        id={`permission-mode-select-${slug}`}
                                        className="permissions-mode-select"
                                        value={permissionMode}
                                        onChange={(e) => setPermissionMode(e.target.value as PermissionMode)}
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
                                    onMouseDown={(e) => e.stopPropagation()}
                                    disabled={permissionsSaving}
                                >
                                    {permissionsSaving ? 'Saving...' : 'Save Permissions'}
                                </button>
                                <button
                                    type="button"
                                    className="permissions-editor-cancel-btn"
                                    onClick={() => setShowPermissionsEditor(false)}
                                    onMouseDown={(e) => e.stopPropagation()}
                                    disabled={permissionsSaving}
                                >
                                    Cancel
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            <CardActions
                viewLabel={viewLabel}
                onView={() => onOpen(slug)}
                showRunAction={showRunAction}
                runLabel={runLabel}
                canRun={can_run}
                onRunAi={onRunAi}
                onRunManual={onRunManual}
                deleteVisible={canDelete}
                deleting={deleting}
                onDelete={() => {
                    void handleDelete();
                }}
            />
        </div>
    );
}
