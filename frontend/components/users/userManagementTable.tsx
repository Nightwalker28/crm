"use client";

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import Image from "next/image";
import Pagination from "../ui/Pagination";
import UserFilters, { type UserFiltersValue } from "@/components/users/userFilters";
import { Pill } from "@/components/ui/Pill"; 
import { apiFetch } from "@/lib/api";
import type { SavedViewCondition, SavedViewFilters } from "@/hooks/useSavedViews";
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
  photo_url?: string;
  auth_mode?: "manual_only" | "manual_or_google";
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
  onStateChange?: (state: {
    filters: UserFiltersValue;
    sortKey: SortKey;
    sortDirection: SortDirection;
  }) => void;
};

function filtersEqual(a: UserFiltersValue, b: UserFiltersValue) {
  return (
    a.search === b.search &&
    a.filtersOpen === b.filtersOpen &&
    a.selectedTeams.join("|") === b.selectedTeams.join("|") &&
    a.selectedRoles.join("|") === b.selectedRoles.join("|") &&
    a.selectedStatuses.join("|") === b.selectedStatuses.join("|")
  );
}

// --- Color Configurations ---
// We map role names to Tailwind class strings here
const ROLE_STYLES: Record<string, { bg: string; text: string; border: string }> = {
  admin: { 
    bg: "bg-red-900/30", 
    text: "text-red-300", 
    border: "border-red-700/50" 
  },
  "super user": { 
    bg: "bg-orange-900/30", 
    text: "text-orange-300", 
    border: "border-orange-700/50" 
  },
  user: { 
    bg: "bg-sky-900/40", 
    text: "text-sky-200", 
    border: "border-sky-700/50" 
  },
  viewer: { 
    bg: "bg-violet-900/40", 
    text: "text-violet-300", 
    border: "border-violet-700/50" 
  },
  unassigned: {
    bg: "bg-zinc-900/40",
    text: "text-zinc-400",
    border: "border-zinc-700/50"
  }
};

const DEFAULT_ROLE_STYLE = { 
  bg: "bg-neutral-800", 
  text: "text-neutral-200", 
  border: "border-neutral-600" 
};

function getRolePillProps(roleName: string) {
  const key = (roleName || "").toLowerCase();
  return ROLE_STYLES[key] || DEFAULT_ROLE_STYLE;
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

  const teamIds = Array.isArray(filters.team_ids) ? filters.team_ids.filter((id): id is number => typeof id === "number") : [];
  const roleIds = Array.isArray(filters.role_ids) ? filters.role_ids.filter((id): id is number => typeof id === "number") : [];
  const selectedStatuses = Array.isArray(filters.statuses) ? filters.statuses.filter((value): value is string => typeof value === "string") : [];
  const sortBy = typeof filters.sort_by === "string" ? filters.sort_by : "name";
  const sortOrder = typeof filters.sort_order === "string" ? filters.sort_order : "asc";

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
  onStateChange,
}: Props) {
  const [sortKey, setSortKey] = useState<SortKey>(initialSortKey);
  const [sortDirection, setSortDirection] = useState<SortDirection>(initialSortDirection);
  const onStateChangeRef = useRef(onStateChange);
  const isMountedRef = useRef(false);

  const [filters, setFilters] = useState<UserFiltersValue>({
    search: initialFilters?.search ?? "",
    filtersOpen: initialFilters?.filtersOpen ?? false,
    selectedTeams: initialFilters?.selectedTeams ?? [],
    selectedRoles: initialFilters?.selectedRoles ?? [],
    selectedStatuses: initialFilters?.selectedStatuses ?? [],
  });

  useEffect(() => {
    onStateChangeRef.current = onStateChange;
  }, [onStateChange]);

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
    () => filters.selectedTeams.map((name) => teamIdsByName.get(name)).filter((id): id is number => typeof id === "number"),
    [filters.selectedTeams, teamIdsByName],
  );
  const selectedRoleIds = useMemo(
    () => filters.selectedRoles.map((name) => roleIdsByName.get(name)).filter((id): id is number => typeof id === "number"),
    [filters.selectedRoles, roleIdsByName],
  );
  const userListFilters = useMemo<SavedViewFilters>(() => ({
    search: filters.search,
    team_ids: selectedTeamIds,
    role_ids: selectedRoleIds,
    statuses: filters.selectedStatuses,
    all_conditions: allViewConditions,
    any_conditions: anyViewConditions,
    sort_by: sortKey,
    sort_order: sortDirection,
  }), [
    allViewConditions,
    anyViewConditions,
    filters.search,
    filters.selectedStatuses,
    selectedRoleIds,
    selectedTeamIds,
    sortDirection,
    sortKey,
  ]);

  const pagedUsers = usePagedList<User, UsersResponse>({
    queryKey: ["users-paged"],
    fetcher: (currentPage, currentPageSize, currentFilters, columns) => fetchUsers({
      page: currentPage,
      pageSize: currentPageSize,
      filters: currentFilters,
      visibleColumns: columns,
    }),
    visibleColumns,
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

  const groupedByTeam = useMemo(() => {
    if (!users.length) return [];

    const map = new Map<string, User[]>();
    const order: string[] = [];
    for (const u of users) {
      const key = u.team_name || "Untitled Team";
      if (!map.has(key)) {
        map.set(key, []);
        order.push(key);
      }
      map.get(key)!.push(u);
    }

    return order.map((teamName) => ({
      teamName,
      users: map.get(teamName)!
    }));
  }, [users]);

  const columnCount = visibleColumns.length;
  const getUserName = (user: User) => [user.first_name, user.last_name].filter(Boolean).join(" ").trim() || user.email;

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
    const roleProps = getRolePillProps(u.role_name);

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
                <div className="h-6 w-6 rounded bg-neutral-700 flex items-center justify-center text-[10px]">
                  {(u.first_name?.[0] ?? u.email[0] ?? "?").toUpperCase()}
                </div>
              )}

              <div className="flex items-center gap-1 max-w-full">
                <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                  {getUserName(u)}
                </span>
                {isSelf && (
                  <span className="text-[10px] text-neutral-400 shrink-0">
                    (You)
                  </span>
                )}
              </div>
            </div>
          </TableCell>
        );
      case "team_name":
        return <TableCell>{u.team_name}</TableCell>;
      case "role_name":
        return (
          <TableCell>
            <Pill
              bg={roleProps.bg}
              text={roleProps.text}
              border={roleProps.border}
              className="w-22"
            >
              {u.role_name}
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
            {u.auth_mode === "manual_only" ? "Manual only" : "Manual + Google"}
          </TableCell>
        );
      case "is_active":
        return (
          <TableCell>
            {u.is_active === "active" ? (
              <Pill bg="bg-green-900/30" text="text-green-400" border="border-green-700/40">
                Active
              </Pill>
            ) : (
              <Pill bg="bg-zinc-900/30" text="text-zinc-400" border="border-zinc-700/40">
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
    setFilters(newFilters);
    goToUserPage(1);
  };

  const clearAllFilters = () => {
    handleFilterChange({
      search: "",
      filtersOpen: filters.filtersOpen,
      selectedTeams: [],
      selectedRoles: [],
      selectedStatuses: [],
    });
  };

  const handleHeaderClick = (key: SortKey) => {
    if (sortKey === key) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
    goToUserPage(1);
  };

  useEffect(() => {
    const nextFilters = {
      search: initialFilters?.search ?? "",
      filtersOpen: initialFilters?.filtersOpen ?? false,
      selectedTeams: initialFilters?.selectedTeams ?? [],
      selectedRoles: initialFilters?.selectedRoles ?? [],
      selectedStatuses: initialFilters?.selectedStatuses ?? [],
    };
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFilters((current) => (filtersEqual(current, nextFilters) ? current : nextFilters));
    setSortKey((current) => (current === initialSortKey ? current : initialSortKey));
    setSortDirection((current) => (current === initialSortDirection ? current : initialSortDirection));
    goToUserPage(1);
  }, [stateKey, initialFilters, initialSortDirection, initialSortKey, goToUserPage]);

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true;
      return;
    }
    onStateChangeRef.current?.({ filters, sortKey, sortDirection });
  }, [filters, sortDirection, sortKey]);

  return (
    <div className="flex flex-col gap-4 text-neutral-200">
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

      <div className="flex flex-col gap-2">
        <ModuleTableShell>
          <Table className="min-w-[900px]">
            <TableHeader >
              <TableHeaderRow className="">
                {visibleColumns.map((column) => renderHead(column))}
              </TableHeaderRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center py-10 text-neutral-500">
                    Loading data...
                  </TableCell>
                </TableRow>
              ) : groupedByTeam.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={columnCount} className="text-center py-10 text-neutral-500">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                groupedByTeam.map(({ teamName, users }) => (
                  <Fragment key={teamName}>
                    <TableGroupRow>
                      <TableGroupCell colSpan={columnCount}>
                         <span className="font-semibold text-neutral-300">{teamName}</span>
                      </TableGroupCell>
                    </TableGroupRow>

                    {users.map((u) => {
                      return (
                        <TableRow
                          key={u.id}
                          className="cursor-pointer"
                          onClick={() => onEdit(u)}
                        >
                          {visibleColumns.map((column) => (
                            <Fragment key={column}>{renderUserCell(u, column)}</Fragment>
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
            onPageChange={goToUserPage}
            onPageSizeChange={onUserPageSizeChange}
          />
        </Card>
      </div>
    </div>
  );
}
