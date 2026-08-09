"use client";

import { useEffect, useMemo } from "react";
import { Plus } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";

import CreateUserDialog from "@/components/users/createUserDialog";
import EditUserDialog from "@/components/users/editUserDialog";
import type { UserFiltersValue } from "@/components/users/userFilters";
import { UserManagementTable, type SortDirection, type SortKey } from "@/components/users/userManagementTable";
import { IdentitySettingsNav } from "@/components/settings/IdentitySettingsNav";
import { Button } from "@/components/ui/button";
import { InlineSavedViewFilters } from "@/components/ui/InlineSavedViewFilters";
import { PageToolbar } from "@/components/ui/PageToolbar";
import { SavedViewSelector } from "@/components/ui/SavedViewSelector";
import { useUserManagement } from "@/hooks/admin/useUserManagement";
import { useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import { useSavedViews } from "@/hooks/useSavedViews";
import { buildModuleViewDefinition, MODULE_VIEW_DEFAULTS, resolveSavedViewFilters, resolveVisibleColumns } from "@/lib/moduleViewConfigs";
import { canonicalSavedViewFiltersKey } from "@/lib/savedViewQuery";
import { SETTINGS_ROUTES } from "@/lib/routes";

const legacyRoutes: Record<string, string> = {
  authentication: SETTINGS_ROUTES.authentication,
  domains: SETTINGS_ROUTES.domains,
  provisioning: SETTINGS_ROUTES.provisioning,
};

export default function UsersSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const legacyTarget = legacyRoutes[searchParams.get("tab") ?? ""];
  const createRequested = searchParams.get("action") === "create-user";

  useEffect(() => {
    if (!legacyTarget) return;
    const next = new URLSearchParams(searchParams.toString());
    next.delete("tab");
    const query = next.toString();
    const suffix = query ? `?${query}` : "";
    router.replace(`${legacyTarget}${suffix}`);
  }, [legacyTarget, router, searchParams]);

  if (legacyTarget) return <div aria-live="polite" className="text-sm text-copy-muted">Opening settings…</div>;
  return <UsersWorkspace createRequested={createRequested} />;
}

function UsersWorkspace({ createRequested }: { createRequested: boolean }) {
  const router = useRouter();
  const { fields } = useModuleFieldConfigs("admin_users");
  const definition = useMemo(() => buildModuleViewDefinition("admin_users", [], fields), [fields]);
  const defaultConfig = definition?.defaultConfig ?? MODULE_VIEW_DEFAULTS.admin_users;
  const admin = useUserManagement();
  const { views, selectedViewId, setSelectedViewId, draftConfig, setDraftConfig } = useSavedViews("admin_users", defaultConfig);
  const activeFilters = resolveSavedViewFilters(definition, draftConfig.filters);
  const visibleColumns = resolveVisibleColumns(definition, draftConfig, defaultConfig);
  const viewFilters = useMemo(() => ({
    search: typeof activeFilters?.search === "string" ? activeFilters.search : "",
    filtersOpen: Boolean(activeFilters?.filtersOpen),
    selectedTeams: Array.isArray(activeFilters?.selectedTeams) ? activeFilters.selectedTeams as string[] : [],
    selectedRoles: Array.isArray(activeFilters?.selectedRoles) ? activeFilters.selectedRoles as string[] : [],
    selectedStatuses: Array.isArray(activeFilters?.selectedStatuses) ? activeFilters.selectedStatuses as string[] : [],
  }) satisfies UserFiltersValue, [activeFilters]);
  const viewSort = useMemo(() => ({ key: (typeof draftConfig.sort?.key === "string" ? draftConfig.sort.key : "name") as SortKey, direction: (draftConfig.sort?.direction === "desc" ? "desc" : "asc") as SortDirection }), [draftConfig.sort]);

  function closeCreate() {
    admin.closeCreateModal();
    if (createRequested) router.replace(SETTINGS_ROUTES.users, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-5 text-copy-primary">
      <IdentitySettingsNav />
      <PageToolbar>
        <SavedViewSelector moduleKey="admin_users" views={views} selectedViewId={selectedViewId} onSelect={setSelectedViewId} />
        <Button onClick={admin.openCreateModal}><Plus />Add User</Button>
      </PageToolbar>
      <InlineSavedViewFilters
        filterFields={definition?.filterFields ?? []}
        filters={activeFilters}
        onChange={(nextFilters) => setDraftConfig((current) => ({ ...current, filters: { ...nextFilters, selectedTeams: Array.isArray(current.filters?.selectedTeams) ? current.filters.selectedTeams : [], selectedRoles: Array.isArray(current.filters?.selectedRoles) ? current.filters.selectedRoles : [], selectedStatuses: Array.isArray(current.filters?.selectedStatuses) ? current.filters.selectedStatuses : [] } }))}
      />
      <UserManagementTable
        currentUserId={admin.currentUserId}
        optionsData={admin.optionsData}
        onEdit={admin.openEditModal}
        onBulkUpdate={admin.bulkUpdateUsers}
        visibleColumns={visibleColumns}
        stateKey={selectedViewId}
        initialFilters={viewFilters}
        initialSortKey={viewSort.key}
        initialSortDirection={viewSort.direction}
        allViewConditions={Array.isArray(activeFilters.all_conditions) ? activeFilters.all_conditions : []}
        anyViewConditions={Array.isArray(activeFilters.any_conditions) ? activeFilters.any_conditions : []}
        onStateChange={({ filters: next, sortKey, sortDirection }) => setDraftConfig((current) => {
          const nextSort = { key: sortKey, direction: sortDirection };
          const nextFilters = { ...next, conditions: [], all_conditions: Array.isArray(activeFilters.all_conditions) ? activeFilters.all_conditions : [], any_conditions: Array.isArray(activeFilters.any_conditions) ? activeFilters.any_conditions : [] };
          if (canonicalSavedViewFiltersKey(current.filters ?? {}) === canonicalSavedViewFiltersKey(nextFilters) && JSON.stringify(current.sort ?? null) === JSON.stringify(nextSort)) return current;
          return { ...current, filters: nextFilters, sort: nextSort };
        })}
      />
      <CreateUserDialog open={admin.isCreateOpen || createRequested} roles={admin.roles} teams={admin.teams} onClose={closeCreate} onCreate={admin.createUser} />
      {admin.editUserData ? <EditUserDialog open={admin.isEditOpen} user={admin.editUserData} roles={admin.roles} teams={admin.teams} currentUserId={admin.currentUserId} onClose={admin.closeEditModal} onSave={async (id, form) => { await admin.updateUser(id, form); admin.closeEditModal(); }} onResetMfa={async (id) => { await admin.resetUserMfa(id); admin.closeEditModal(); }} isResettingMfa={admin.isResettingUserMfa} /> : null}
    </div>
  );
}
