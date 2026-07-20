"use client";

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import Image from "next/image";
import { UsersRound } from "lucide-react";
import Pagination from "../ui/Pagination";
import UserFilters, {
  type UserFiltersValue,
} from "@/components/users/userFilters";
import { Pill } from "@/components/ui/Pill";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { ModuleTableLoading } from "@/components/ui/ModuleTableLoading";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiFetch } from "@/lib/api";
import type {
  SavedViewCondition,
  SavedViewFilters,
} from "@/hooks/useSavedViews";
import { usePagedList } from "@/hooks/usePagedList";
import { appendSavedViewFilterParams } from "@/lib/savedViewQuery";

import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHeaderRow,
  TableHead,
  TableCell,
  TableGroupRow,
  TableGroupCell,
  SortableHead,
} from "@/components/ui/Table";
import { Card } from "../ui/Card";
import { ModuleTableShell } from "../ui/ModuleTableShell";
import { resolveMediaUrl } from "@/lib/media";

export type SortKey = "name" | "role" | "email" | "status";
export type SortDirection = "asc" | "desc";
export type UserStatus = "active" | "inactive";

export type User = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
  team_id: number;
  role_id: number;
  team_name: string;
  role_name: string;
  role_level?: number | null;
  photo_url?: string;
  auth_mode?: "manual_only" | "manual_or_google";
  mfa_enabled?: boolean;
  mfa_required?: boolean;
  is_active: UserStatus;
};

type UserOptionsData = {
  roles: Array<{ id: number; name: string }>;
  teams: Array<{ id: number; name: string }>;
  statuses: string[];
};

type UsersResponse = {
  results: User[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

type Props = {
  currentUserId?: number | null;
  optionsData: UserOptionsData;
  onEdit: (u: User) => void;
  visibleColumns: string[];
  stateKey?: string;
  initialFilters?: UserFiltersValue;
  initialSortKey?: SortKey;
  initialSortDirection?: SortDirection;
  allViewConditions?: SavedViewCondition[];
  anyViewConditions?: SavedViewCondition[];
  onBulkUpdate: (
    userIds: number[],
    changes: { role_id?: number; is_active?: UserStatus },
  ) => Promise<void>;
  onStateChange?: (state: {
    filters: UserFiltersValue;
    sortKey: SortKey;
    sortDirection: SortDirection;
  }) => void;
};

function filtersEqual(a: UserFiltersValue, b: UserFiltersValue) {
  const sameSet = (left: string[], right: string[]) => {
    if (left.length !== right.length) return false;
    const sortedLeft = [...left].sort();
    const sortedRight = [...right].sort();
    return sortedLeft.every((value, index) => value === sortedRight[index]);
  };

  return (
    a.search === b.search &&
    sameSet(a.selectedTeams, b.selectedTeams) &&
    sameSet(a.selectedRoles, b.selectedRoles) &&
    sameSet(a.selectedStatuses, b.selectedStatuses)
  );
}

// --- Color Configurations ---
const ROLE_LEVEL_STYLES = {
  admin: {
    bg: "bg-state-danger-muted",
    text: "text-state-danger",
    border: "border-state-danger/40",
  },
  elevated: {
    bg: "bg-state-warning-muted",
    text: "text-state-warning",
    border: "border-state-warning/40",
  },
  standard: {
    bg: "bg-state-info-muted",
    text: "text-state-info",
    border: "border-state-info/40",
  },
  basic: {
    bg: "bg-action-primary-muted",
    text: "text-copy-primary",
    border: "border-line-strong",
  },
  unassigned: {
    bg: "bg-surface-muted",
    text: "text-copy-muted",
    border: "border-line-default",
  },
};

const DEFAULT_ROLE_STYLE = {
  bg: "bg-surface-muted",
  text: "text-copy-secondary",
  border: "border-line-default",
};

function getRolePillProps(roleName: string, roleLevel?: number | null) {
  if (!roleName || roleName === "Unassigned")
    return ROLE_LEVEL_STYLES.unassigned;
  if (typeof roleLevel !== "number") return DEFAULT_ROLE_STYLE;
  if (roleLevel >= 100) return ROLE_LEVEL_STYLES.admin;
  if (roleLevel >= 90) return ROLE_LEVEL_STYLES.elevated;
  if (roleLevel >= 10) return ROLE_LEVEL_STYLES.standard;
  return ROLE_LEVEL_STYLES.basic;
}

// --- Fetcher Functions ---

const fetchUsers = async ({
  page,
  pageSize,
  filters,
  visibleColumns,
}: {
  page: number;
  pageSize: number;
  filters: SavedViewFilters;
  visibleColumns: string[];
}): Promise<UsersResponse> => {
  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("page_size", pageSize.toString());
  if (visibleColumns.length) params.append("fields", visibleColumns.join(","));
  appendSavedViewFilterParams(params, filters);

  const teamIds = Array.isArray(filters.team_ids)
    ? filters.team_ids.filter((id): id is number => typeof id === "number")
    : [];
  const roleIds = Array.isArray(filters.role_ids)
    ? filters.role_ids.filter((id): id is number => typeof id === "number")
    : [];
  const selectedStatuses = Array.isArray(filters.statuses)
    ? filters.statuses.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const sortBy = typeof filters.sort_by === "string" ? filters.sort_by : "name";
  const sortOrder =
    typeof filters.sort_order === "string" ? filters.sort_order : "asc";

  if (teamIds.length) params.append("teams", teamIds.join(","));
  if (roleIds.length) params.append("roles", roleIds.join(","));
  if (selectedStatuses.length > 0) {
    params.append("status", selectedStatuses.join(","));
  }
  params.append("sort_by", sortBy);
  params.append("sort_order", sortOrder);

  const res = await apiFetch(`/admin/users/search?${params.toString()}`);
  if (!res.ok) throw new Error("Network response was not ok");
  return res.json();
};

export function UserManagementTable({
  currentUserId,
  optionsData,
  onEdit,
  visibleColumns = [],
  stateKey,
  initialFilters,
  initialSortKey = "name",
  initialSortDirection = "asc",
  allViewConditions = [],
  anyViewConditions = [],
  onBulkUpdate,
  onStateChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(() => initialSortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(
    () => initialSortDirection,
  );
  const onStateChangeRef = useRef(onStateChange);
  const isMountedRef = useRef(false);
  const lastStateKeyRef = useRef(stateKey);
  const suppressNextStateChangeRef = useRef(false);

  const [filters, setFilters] = useState<UserFiltersValue>(() => ({
    search: initialFilters?.search ?? "",
    filtersOpen: initialFilters?.filtersOpen ?? false,
    selectedTeams: initialFilters?.selectedTeams ?? [],
    selectedRoles: initialFilters?.selectedRoles ?? [],
    selectedStatuses: initialFilters?.selectedStatuses ?? [],
  }));
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [bulkRoleId, setBulkRoleId] = useState("__no_change__");
  const [bulkStatus, setBulkStatus] = useState("__no_change__");
  const [bulkSaving, setBulkSaving] = useState(false);
  const [bulkError, setBulkError] = useState<string | null>(null);
  const currentStateRef = useRef({ filters, sortKey, sortDirection });

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

  useEffect(() => {
    currentStateRef.current = { filters, sortKey, sortDirection };
  }, [filters, sortDirection, sortKey]);

  const { teamIdsByName, roleIdsByName } = useMemo(() => {
    const teamMap = new Map<string, number>();
    const roleMap = new Map<string, number>();

    if (optionsData?.teams) {
      optionsData.teams.forEach((team) => teamMap.set(team.name, team.id));
    }
    if (optionsData?.roles) {
      optionsData.roles.forEach((role) => roleMap.set(role.name, role.id));
    }
    return { teamIdsByName: teamMap, roleIdsByName: roleMap };
  }, [optionsData]);

  const selectedTeamIds = useMemo(
    () =>
      filters.selectedTeams
        .map((name) => teamIdsByName.get(name))
        .filter((id): id is number => typeof id === "number"),
    [filters.selectedTeams, teamIdsByName],
  );
  const selectedRoleIds = useMemo(
    () =>
      filters.selectedRoles
        .map((name) => roleIdsByName.get(name))
        .filter((id): id is number => typeof id === "number"),
    [filters.selectedRoles, roleIdsByName],
  );
  const userListFilters = useMemo<SavedViewFilters>(
    () => ({
      search: filters.search,
      team_ids: selectedTeamIds,
      role_ids: selectedRoleIds,
      statuses: filters.selectedStatuses,
      all_conditions: allViewConditions,
      any_conditions: anyViewConditions,
      sort_by: sortKey,
      sort_order: sortDirection,
    }),
    [
      allViewConditions,
      anyViewConditions,
      filters.search,
      filters.selectedStatuses,
      selectedRoleIds,
      selectedTeamIds,
      sortDirection,
      sortKey,
    ],
  );

  const pagedUsers = usePagedList<User, UsersResponse>({
    queryKey: ["users-paged"],
    fetcher: (currentPage, currentPageSize, currentFilters, columns) =>
      fetchUsers({
        page: currentPage,
        pageSize: currentPageSize,
        filters: currentFilters,
        visibleColumns: columns,
      }),
    visibleColumns,
    visibleColumnsAffectQuery: true,
    filters: userListFilters,
    initialPage: 1,
    initialPageSize: 10,
    refetchOnWindowFocus: false,
  });

  const users = pagedUsers.items;
  const totalCount = pagedUsers.totalCount;
  const totalPages = pagedUsers.totalPages;
  const page = pagedUsers.page;
  const pageSize = pagedUsers.pageSize;
  const isLoading = pagedUsers.isLoading;
  const isFetching = pagedUsers.isFetching;
  const goToUserPage = pagedUsers.goToPage;
  const onUserPageSizeChange = pagedUsers.onPageSizeChange;
  const selectablePageIds = users
    .filter((user) => user.id !== currentUserId)
    .map((user) => user.id);
  const allPageSelected =
    selectablePageIds.length > 0 &&
    selectablePageIds.every((id) => selectedIds.includes(id));
  const hasActiveFilters = Boolean(
    filters.search.trim() ||
    filters.selectedTeams.length ||
    filters.selectedRoles.length ||
    filters.selectedStatuses.length ||
    allViewConditions.length ||
    anyViewConditions.length,
  );

  const groupedByTeam = useMemo(() => {
    if (!users.length) return [];

    const map = new Map<string, User[]>();
    const order: string[] = [];
    for (const u of users) {
      const key =
        u.team_name && u.team_name !== "Unassigned"
          ? u.team_name
          : "Unassigned";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(u);
    }

    return order.map((teamName) => ({
      teamName,
      users: map.get(teamName)!,
    }));
  }, [users]);

  const columnCount = visibleColumns.length + 1;
  const getUserName = (user: User) =>
    [user.first_name, user.last_name].filter(Boolean).join(" ").trim() ||
    user.email;
  const getTeamName = (user: User) =>
    user.team_name || (user.team_id ? `Team #${user.team_id}` : "Unassigned");
  const getRoleName = (user: User) =>
    user.role_name || (user.role_id ? `Role #${user.role_id}` : "Unassigned");

  const renderHead = (column: string) => {
    switch (column) {
      case "name":
        return (
          <SortableHead
            key={column}
            sorted={sortKey === "name"}
            direction={sortDirection}
            onClick={() => handleHeaderClick("name")}
          >
            Name
          </SortableHead>
        );
      case "team_name":
        return <TableHead key={column}>Team</TableHead>;
      case "role_name":
        return (
          <SortableHead
            key={column}
            sorted={sortKey === "role"}
            direction={sortDirection}
            onClick={() => handleHeaderClick("role")}
          >
            Role
          </SortableHead>
        );
      case "email":
        return (
          <SortableHead
            key={column}
            sorted={sortKey === "email"}
            direction={sortDirection}
            onClick={() => handleHeaderClick("email")}
          >
            Email
          </SortableHead>
        );
      case "auth_mode":
        return <TableHead key={column}>Sign-in Mode</TableHead>;
      case "mfa_enabled":
        return <TableHead key={column}>MFA</TableHead>;
      case "is_active":
        return (
          <SortableHead
            key={column}
            sorted={sortKey === "status"}
            direction={sortDirection}
            onClick={() => handleHeaderClick("status")}
          >
            Status
          </SortableHead>
        );
      default:
        return null;
    }
  };

  const renderUserCell = (u: User, column: string) => {
    const isSelf = typeof currentUserId === "number" && u.id === currentUserId;
    const teamName = getTeamName(u);
    const roleName = getRoleName(u);
    const roleProps = getRolePillProps(roleName, u.role_level);

    switch (column) {
      case "name":
        return (
          <TableCell>
            <div className="flex items-center gap-2 h-7">
              {u.photo_url ? (
                <Image
                  src={resolveMediaUrl(u.photo_url)}
                  alt=""
                  width={24}
                  height={24}
                  unoptimized
                  className="h-6 w-6 rounded object-cover"
                />
              ) : (
                <div className="flex h-6 w-6 items-center justify-center rounded bg-surface-raised text-[10px] text-copy-secondary">
                  {(u.first_name?.[0] ?? u.email[0] ?? "?").toUpperCase()}
                </div>
              )}

              <div className="flex items-center gap-1 max-w-full">
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                  {getUserName(u)}
                </span>
                {isSelf && (
                  <span className="shrink-0 text-[10px] text-copy-muted">
                    (You)
                  </span>
                )}
              </div>
            </div>
          </TableCell>
        );
      case "team_name":
        return <TableCell>{teamName}</TableCell>;
      case "role_name":
        return (
          <TableCell>
            <Pill
              bg={roleProps.bg}
              text={roleProps.text}
              border={roleProps.border}
              className="w-22"
            >
              {roleName}
            </Pill>
          </TableCell>
        );
      case "email":
        return (
          <TableCell>
            <span className="whitespace-nowrap overflow-hidden text-ellipsis block">
              {u.email}
            </span>
          </TableCell>
        );
      case "auth_mode":
        return (
          <TableCell>
            {u.auth_mode === "manual_only" ? "Manual only" : "Manual + SSO"}
          </TableCell>
        );
      case "mfa_enabled":
        return (
          <TableCell>
            {u.mfa_enabled ? (
              <Pill
                bg="bg-state-success-muted"
                text="text-state-success"
                border="border-state-success/40"
              >
                Enabled
              </Pill>
            ) : u.mfa_required ? (
              <Pill
                bg="bg-state-warning-muted"
                text="text-state-warning"
                border="border-state-warning/40"
              >
                Required
              </Pill>
            ) : (
              <Pill
                bg="bg-surface-muted"
                text="text-copy-muted"
                border="border-line-default"
              >
                Off
              </Pill>
            )}
          </TableCell>
        );
      case "is_active":
        return (
          <TableCell>
            {u.is_active === "active" ? (
              <Pill
                bg="bg-state-success-muted"
                text="text-state-success"
                border="border-state-success/40"
              >
                Active
              </Pill>
            ) : (
              <Pill
                bg="bg-surface-muted"
                text="text-copy-muted"
                border="border-line-default"
              >
                Inactive
              </Pill>
            )}
          </TableCell>
        );
      default:
        return null;
    }
  };

  const handleFilterChange = (newFilters: UserFiltersValue) => {
    suppressNextStateChangeRef.current = false;
    setFilters(newFilters);
    goToUserPage(1);
  };

  const clearAllFilters = () => {
    setSelectedIds([]);
    handleFilterChange({
      search: "",
      filtersOpen: filters.filtersOpen,
      selectedTeams: [],
      selectedRoles: [],
      selectedStatuses: [],
    });
  };

  const handleHeaderClick = (key: SortKey) => {
    setSelectedIds([]);
    suppressNextStateChangeRef.current = false;
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    goToUserPage(1);
  };

  async function applyBulkUpdate() {
    if (!selectedIds.length) return;
    const changes: { role_id?: number; is_active?: UserStatus } = {};
    if (bulkRoleId !== "__no_change__") changes.role_id = Number(bulkRoleId);
    if (bulkStatus !== "__no_change__")
      changes.is_active = bulkStatus as UserStatus;
    if (!changes.role_id && !changes.is_active) return;

    try {
      setBulkSaving(true);
      setBulkError(null);
      await onBulkUpdate(selectedIds, changes);
      setSelectedIds([]);
      setBulkRoleId("__no_change__");
      setBulkStatus("__no_change__");
    } catch {
      setBulkError(
        "We could not update the selected users. Review the selection and try again.",
      );
    } finally {
      setBulkSaving(false);
    }
  }

  useEffect(() => {
    if (lastStateKeyRef.current === stateKey) return;
    lastStateKeyRef.current = stateKey;

    const nextFilters = {
      search: initialFilters?.search ?? "",
      filtersOpen: initialFilters?.filtersOpen ?? false,
      selectedTeams: initialFilters?.selectedTeams ?? [],
      selectedRoles: initialFilters?.selectedRoles ?? [],
      selectedStatuses: initialFilters?.selectedStatuses ?? [],
    };
    const currentState = currentStateRef.current;
    suppressNextStateChangeRef.current =
      !filtersEqual(currentState.filters, nextFilters) ||
      currentState.sortKey !== initialSortKey ||
      currentState.sortDirection !== initialSortDirection;
    setFilters((current) =>
      filtersEqual(current, nextFilters) ? current : nextFilters,
    );
    setSortKey((current) =>
      current === initialSortKey ? current : initialSortKey,
    );
    setSortDirection((current) =>
      current === initialSortDirection ? current : initialSortDirection,
    );
    goToUserPage(1);
  }, [
    stateKey,
    initialFilters,
    initialSortDirection,
    initialSortKey,
    goToUserPage,
  ]);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    if (suppressNextStateChangeRef.current) {
      suppressNextStateChangeRef.current = false;
      return;
    }
    onStateChangeRef.current?.({ filters, sortKey, sortDirection });
  }, [filters, sortDirection, sortKey]);

  return (
    <div className="flex flex-col gap-4 text-copy-primary">
      <UserFilters
        value={filters}
        options={{
          totalCount: totalCount,
          allTeams: optionsData?.teams?.map((team) => team.name).sort() || [],
          allRoles: optionsData?.roles?.map((role) => role.name).sort() || [],
          allStatuses: optionsData?.statuses || [],
        }}
        isLoading={isFetching}
        onChange={handleFilterChange}
        onClear={clearAllFilters}
      />

      {selectedIds.length ? (
        <Card className="border-line-strong px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
            <div className="min-w-40 text-sm font-medium text-copy-primary">
              {selectedIds.length} user{selectedIds.length === 1 ? "" : "s"}{" "}
              selected
            </div>
            <Select value={bulkRoleId} onValueChange={setBulkRoleId}>
              <SelectTrigger className="w-full sm:w-56" aria-label="Bulk role">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__no_change__">
                  Keep current roles
                </SelectItem>
                {optionsData.roles.map((role) => (
                  <SelectItem key={role.id} value={String(role.id)}>
                    Set role: {role.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={bulkStatus} onValueChange={setBulkStatus}>
              <SelectTrigger
                className="w-full sm:w-52"
                aria-label="Bulk status"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__no_change__">
                  Keep current status
                </SelectItem>
                <SelectItem value="active">Set active</SelectItem>
                <SelectItem value="inactive">Set inactive</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex flex-wrap gap-2 xl:ml-auto">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setSelectedIds([])}
                disabled={bulkSaving}
              >
                Clear selection
              </Button>
              <Button
                type="button"
                onClick={() => void applyBulkUpdate()}
                disabled={
                  bulkSaving ||
                  (bulkRoleId === "__no_change__" &&
                    bulkStatus === "__no_change__")
                }
              >
                {bulkSaving ? "Updating…" : "Apply changes"}
              </Button>
            </div>
          </div>
          {bulkError ? (
            <p className="mt-3 text-sm text-state-danger" role="alert">
              {bulkError}
            </p>
          ) : null}
        </Card>
      ) : null}

      <div className="flex flex-col gap-2">
        <ModuleTableShell>
          <Table className="min-w-[900px]">
            <TableHeader>
              <TableHeaderRow>
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all users on this page"
                    checked={allPageSelected}
                    disabled={!selectablePageIds.length}
                    onCheckedChange={(checked) =>
                      setSelectedIds((current) =>
                        checked === true
                          ? Array.from(
                              new Set([...current, ...selectablePageIds]),
                            )
                          : current.filter(
                              (id) => !selectablePageIds.includes(id),
                            ),
                      )
                    }
                  />
                </TableHead>
                {visibleColumns.map((column) => renderHead(column))}
              </TableHeaderRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <ModuleTableLoading columnCount={columnCount} />
              ) : groupedByTeam.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="py-14">
                    <EmptyState
                      icon={UsersRound}
                      title={
                        hasActiveFilters
                          ? "No users match these filters"
                          : "No users yet"
                      }
                      description={
                        hasActiveFilters
                          ? "Clear one or more filters and try again."
                          : "Use Add User to provision the first user in this workspace."
                      }
                      action={
                        hasActiveFilters ? (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={clearAllFilters}
                          >
                            Clear filters
                          </Button>
                        ) : undefined
                      }
                    />
                  </TableCell>
                </TableRow>
              ) : (
                groupedByTeam.map(({ teamName, users }) => (
                  <Fragment key={teamName}>
                    <TableGroupRow>
                      <TableGroupCell colSpan={columnCount}>
                        <span className="font-semibold text-copy-secondary">
                          {teamName}
                        </span>
                      </TableGroupCell>
                    </TableGroupRow>

                    {users.map((u) => {
                      return (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => onEdit(u)}
                        >
                          <TableCell
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Checkbox
                              aria-label={`Select ${getUserName(u)}`}
                              checked={selectedIds.includes(u.id)}
                              disabled={u.id === currentUserId}
                              onCheckedChange={(checked) =>
                                setSelectedIds((current) =>
                                  checked === true
                                    ? Array.from(new Set([...current, u.id]))
                                    : current.filter((id) => id !== u.id),
                                )
                              }
                            />
                          </TableCell>
                          {visibleColumns.map((column) => (
                            <Fragment key={column}>
                              {renderUserCell(u, column)}
                            </Fragment>
                          ))}
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </ModuleTableShell>

        {/* --- Pagination Footer --- */}
        <Card className="px-4 py-1.5">
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize}
            rangeStart={pagedUsers.rangeStart}
            rangeEnd={pagedUsers.rangeEnd}
            onPageChange={(nextPage) => {
              setSelectedIds([]);
              goToUserPage(nextPage);
            }}
            onPageSizeChange={(nextPageSize) => {
              setSelectedIds([]);
              onUserPageSizeChange(nextPageSize);
            }}
          />
        </Card>
      </div>
    </div>
  );
}
