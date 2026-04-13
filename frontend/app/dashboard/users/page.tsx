"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { UserManagementTable } from "@/components/users/userManagementTable";
import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import { useUserManagement } from "@/hooks/admin/useUserManagement";

export default function UserManagementPage() {
  const {
    currentUserId,
    editUserData,
    isEditOpen,
    isCreateOpen,
    optionsData,
    roles,
    teams,
    openEditModal,
    closeEditModal,
    openCreateModal,
    closeCreateModal,
    createUser,
    updateUser,
  } = useUserManagement();


  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold leading-none">User Management</h1>
        <Button onClick={openCreateModal}>
          <Plus />
          Add User
        </Button>
      </div>

      <UserManagementTable
        currentUserId={currentUserId}
        optionsData={optionsData}
        onEdit={openEditModal}
      />

      <CreateUserDialog
        open={isCreateOpen}
        roles={roles}
        teams={teams}
        onClose={closeCreateModal}
        onCreate={createUser}
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
          onSave={async (id, form) => {
            await updateUser(id, form);
            closeEditModal();
          }}
        />
      )}
    </div>
  );
}
