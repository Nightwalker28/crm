"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { UserManagementTable, type SortDirection, type SortKey } from "@/components/users/userManagementTable";
import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import { useUserManagement } from "@/hooks/admin/useUserManagement";
import { useSavedViews } from "@/hooks/useSavedViews";
import { getModuleViewDefinition, MODULE_VIEW_DEFAULTS } from "@/lib/moduleViewConfigs";
import type { UserFiltersValue } from "@/components/users/userFilters";
import { useMemo } from "react";

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
  const {
    views,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
  } = useSavedViews(
    "admin_users",
    MODULE_VIEW_DEFAULTS.admin_users,
  );
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : MODULE_VIEW_DEFAULTS.admin_users.visible_columns;
  const viewFilters = useMemo(
    () =>
      ({
        search: typeof draftConfig.filters?.search === "string" ? draftConfig.filters.search : "",
        filtersOpen: Boolean(draftConfig.filters?.filtersOpen),
        selectedTeams: Array.isArray(draftConfig.filters?.selectedTeams) ? draftConfig.filters.selectedTeams as string[] : [],
        selectedRoles: Array.isArray(draftConfig.filters?.selectedRoles) ? draftConfig.filters.selectedRoles as string[] : [],
        selectedStatuses: Array.isArray(draftConfig.filters?.selectedStatuses) ? draftConfig.filters.selectedStatuses as string[] : [],
      }) satisfies UserFiltersValue,
    [draftConfig.filters],
  );
  const viewSort = useMemo(
    () => ({
      key: (typeof draftConfig.sort?.key === "string" ? draftConfig.sort.key : "name") as SortKey,
      direction: (draftConfig.sort?.direction === "desc" ? "desc" : "asc") as SortDirection,
    }),
    [draftConfig.sort],
  );
  const definition = getModuleViewDefinition("admin_users");


  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold leading-none">User Management</h1>
        <div className="flex items-center gap-3">
          <SavedViewSelector
            moduleKey="admin_users"
            views={views}
            selectedViewId={selectedViewId}
            onSelect={setSelectedViewId}
          />
          <Button onClick={openCreateModal}>
            <Plus />
            Add User
          </Button>
        </div>
      </div>

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={draftConfig.filters}
        onChange={(nextFilters) =>
          setDraftConfig((current) => ({
            ...current,
            filters: {
              ...nextFilters,
              selectedTeams: Array.isArray(current.filters?.selectedTeams) ? current.filters.selectedTeams : [],
              selectedRoles: Array.isArray(current.filters?.selectedRoles) ? current.filters.selectedRoles : [],
              selectedStatuses: Array.isArray(current.filters?.selectedStatuses) ? current.filters.selectedStatuses : [],
            },
          }))
        }
      />

      <UserManagementTable
        currentUserId={currentUserId}
        optionsData={optionsData}
        onEdit={openEditModal}
        visibleColumns={visibleColumns}
        stateKey={selectedViewId}
        initialFilters={viewFilters}
        initialSortKey={viewSort.key}
        initialSortDirection={viewSort.direction}
        allViewConditions={Array.isArray(draftConfig.filters.all_conditions) ? draftConfig.filters.all_conditions : []}
        anyViewConditions={Array.isArray(draftConfig.filters.any_conditions) ? draftConfig.filters.any_conditions : []}
        onStateChange={({ filters, sortKey, sortDirection }) =>
          setDraftConfig((current) => {
            const nextSort = { key: sortKey, direction: sortDirection };
            const nextFilters = {
              ...filters,
              conditions: [],
              all_conditions: Array.isArray(current.filters?.all_conditions) ? current.filters.all_conditions : [],
              any_conditions: Array.isArray(current.filters?.any_conditions) ? current.filters.any_conditions : [],
            };
            const sameFilters =
              JSON.stringify(current.filters ?? {}) === JSON.stringify(nextFilters);
            const sameSort =
              JSON.stringify(current.sort ?? null) === JSON.stringify(nextSort);
            if (sameFilters && sameSort) {
              return current;
            }
            return {
              ...current,
              filters: nextFilters,
              sort: nextSort,
            };
          })
        }
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
