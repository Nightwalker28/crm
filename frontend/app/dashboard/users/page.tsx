"use client";

import {
  UserManagementTable,
} from "@/components/users/userManagementTable";

import EditUserDialog from "@/components/users/editUserDialog";
import ApproveUserDialog from "@/components/users/approveUserDialog";
import RejectUserDialog from "@/components/users/rejectUserDialog";
import { useUserManagement } from "@/hooks/admin/useUserManagement";

export default function UserManagementPage() {
  const {
    currentUserId,
    editUserData,
    isEditOpen,
    approveUserData,
    isApproveOpen,
    rejectUserData,
    isRejectOpen,
    optionsData,
    roles,
    teams,
    openEditModal,
    closeEditModal,
    openApproveModal,
    closeApproveModal,
    openRejectModal,
    closeRejectModal,
    approveUser,
    rejectUser,
    updateUser,
  } = useUserManagement();


  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <h1 className="text-2xl font-semibold leading-none">User Management</h1>

      <UserManagementTable
        currentUserId={currentUserId}
        optionsData={optionsData}
        onApprove={openApproveModal}
        onReject={openRejectModal}
        onEdit={openEditModal}
      />

      {editUserData && (
        <EditUserDialog
          key={editUserData.id}
          open={isEditOpen}
          user={editUserData}
          roles={roles}
          teams={teams}
          currentUserId={currentUserId}
          onClose={closeEditModal}
          onSave={(id, form) => {
            updateUser(id, form);
            closeEditModal();
          }}
        />
      )}

      {approveUserData && (
        <ApproveUserDialog
          key={approveUserData.id}
          open={isApproveOpen}
          user={approveUserData}
          roles={roles}
          teams={teams}
          onClose={closeApproveModal}
          onApprove={async (id, roleId, teamId) => {
            await approveUser(id, roleId, teamId);
            closeApproveModal();
          }}
        />
      )}

      {rejectUserData && (
        <RejectUserDialog
          open={isRejectOpen}
          user={rejectUserData}
          onCancel={closeRejectModal}
          onConfirm={async () => {
            await rejectUser(rejectUserData.id);
            closeRejectModal();
          }}
        />
      )}
    </div>
  );
}
