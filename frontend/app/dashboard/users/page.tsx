"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { UserManagementTable } from "@/components/users/userManagementTable";
import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import { useUserManagement } from "@/hooks/admin/useUserManagement";
import { useTablePreferences } from "@/hooks/useTablePreferences";

const USER_COLUMNS = [
  { key: "name", label: "Name" },
  { key: "team_name", label: "Team" },
  { key: "role_name", label: "Role" },
  { key: "email", label: "Email" },
  { key: "auth_mode", label: "Sign-in Mode" },
  { key: "is_active", label: "Status" },
];

const DEFAULT_USER_COLUMNS = ["name", "team_name", "role_name", "email", "is_active"];

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
  const { visibleColumns, saveVisibleColumns } = useTablePreferences(
    "admin_users",
    USER_COLUMNS,
    DEFAULT_USER_COLUMNS,
  );


  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold leading-none">User Management</h1>
        <div className="flex items-center gap-3">
          <ColumnPicker
            title="User columns"
            options={USER_COLUMNS}
            visibleColumns={visibleColumns}
            onChange={saveVisibleColumns}
          />
          <Button onClick={openCreateModal}>
            <Plus />
            Add User
          </Button>
        </div>
      </div>

      <UserManagementTable
        currentUserId={currentUserId}
        optionsData={optionsData}
        onEdit={openEditModal}
        visibleColumns={visibleColumns}
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
