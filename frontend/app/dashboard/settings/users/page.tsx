"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/PageHeader";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { UserManagementTable, type SortDirection, type SortKey } from "@/components/users/userManagementTable";
import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import { useUserManagement } from "@/hooks/admin/useUserManagement";
import { useSavedViews } from "@/hooks/useSavedViews";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import type { UserFiltersValue } from "@/components/users/userFilters";
import { useMemo } from "react";

export default function UserManagementPage() {
  const { fields: moduleFields } = useModuleFieldConfigs("admin_users");
  const definition = useMemo(() => buildModuleViewDefinition("admin_users", [], moduleFields), [moduleFields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.admin_users;
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
    defaultConfig,
  );
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const viewFilters = useMemo(
    () =>
      ({
        search: typeof activeFilters?.search === "string" ? activeFilters.search : "",
        filtersOpen: Boolean(activeFilters?.filtersOpen),
        selectedTeams: Array.isArray(activeFilters?.selectedTeams) ? activeFilters.selectedTeams as string[] : [],
        selectedRoles: Array.isArray(activeFilters?.selectedRoles) ? activeFilters.selectedRoles as string[] : [],
        selectedStatuses: Array.isArray(activeFilters?.selectedStatuses) ? activeFilters.selectedStatuses as string[] : [],
      }) satisfies UserFiltersValue,
    [activeFilters],
  );
  const viewSort = useMemo(
    () => ({
      key: (typeof draftConfig.sort?.key === "string" ? draftConfig.sort.key : "name") as SortKey,
      direction: (draftConfig.sort?.direction === "desc" ? "desc" : "asc") as SortDirection,
    }),
    [draftConfig.sort],
  );
  return (
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="User Management"
        description="Manage provisioned users, roles, access, and team membership."
        actions={
          <>
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
          </>
        }
      />

      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
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
        allViewConditions={Array.isArray(activeFilters.all_conditions) ? activeFilters.all_conditions : []}
        anyViewConditions={Array.isArray(activeFilters.any_conditions) ? activeFilters.any_conditions : []}
        onStateChange={({ filters, sortKey, sortDirection }) =>
          setDraftConfig((current) => {
            const nextSort = { key: sortKey, direction: sortDirection };
            const nextFilters = {
              ...filters,
              conditions: [],
              all_conditions: Array.isArray(activeFilters.all_conditions) ? activeFilters.all_conditions : [],
              any_conditions: Array.isArray(activeFilters.any_conditions) ? activeFilters.any_conditions : [],
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
