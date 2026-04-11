"use client";

import { useMemo, useState, Fragment } from "react";
import Image from "next/image";
import { Check, X, Pencil } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import Pagination from "../ui/Pagination";
import UserFilters, { type UserFiltersValue } from "@/components/users/userFilters";
import { Pill } from "@/components/ui/Pill"; 
import { apiFetch } from "@/lib/api";

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

export type SortKey = "name" | "role" | "email" | "status";
export type SortDirection = "asc" | "desc";
export type UserStatus = "pending" | "active" | "inactive";

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
  is_active: UserStatus;
};

type UserOptionsData = {
  roles: Array<{ id: number; name: string }>;
  teams: Array<{ id: number; name: string }>;
  statuses: string[];
};

type Props = {
  currentUserId?: number | null;
  optionsData: UserOptionsData;
  onApprove: (u: User) => Promise<void>;
  onReject: (u: User) => Promise<void>;
  onEdit: (u: User) => void;
};

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
  sortKey, 
  sortDirection,
  maps
}: {
  page: number;
  pageSize: number;
  filters: UserFiltersValue;
  sortKey: SortKey;
  sortDirection: SortDirection;
  maps: { teamMap: Map<string, number>, roleMap: Map<string, number> }
}) => {
  
  const isSearchMode = 
      !!filters.search || 
      filters.selectedTeams.length > 0 || 
      filters.selectedRoles.length > 0 || 
      filters.selectedStatuses.length > 0 ||
      sortKey !== "name" || 
      sortDirection !== "asc";

  const endpoint = isSearchMode ? "/admin/users/search" : "/admin/users";

  const params = new URLSearchParams();
  params.append("page", page.toString());
  params.append("page_size", pageSize.toString());

  if (isSearchMode) {
    if (filters.search) params.append("search", filters.search);
    
    const teamIds = filters.selectedTeams
        .map(name => maps.teamMap.get(name))
        .filter(id => id !== undefined);
        
    const roleIds = filters.selectedRoles
        .map(name => maps.roleMap.get(name))
        .filter(id => id !== undefined);

    if (teamIds.length) params.append("teams", teamIds.join(","));
    if (roleIds.length) params.append("roles", roleIds.join(","));

    if (filters.selectedStatuses.length > 0) {
       params.append("status", filters.selectedStatuses.join(","));
    }
    
    params.append("sort_by", sortKey);
    params.append("sort_order", sortDirection);
  }

  const res = await apiFetch(`${endpoint}?${params.toString()}`);
  if (!res.ok) throw new Error("Network response was not ok");
  return res.json();
};

export function UserManagementTable({
  currentUserId,
  optionsData,
  onApprove,
  onReject,
  onEdit,
}: Props) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [filters, setFilters] = useState<UserFiltersValue>({
    search: "",
    filtersOpen: false,
    selectedTeams: [],
    selectedRoles: [],
    selectedStatuses: [],
  });

  const apiFilters = useMemo(() => ({
    search: filters.search,
    selectedTeams: filters.selectedTeams,
    selectedRoles: filters.selectedRoles,
    selectedStatuses: filters.selectedStatuses,
  }), [filters.search, filters.selectedTeams, filters.selectedRoles, filters.selectedStatuses]);

  const maps = useMemo(() => {
    const teamMap = new Map<string, number>();
    const roleMap = new Map<string, number>();
    
    if (optionsData?.teams) {
        optionsData.teams.forEach((t: any) => teamMap.set(t.name, t.id));
    }
    if (optionsData?.roles) {
        optionsData.roles.forEach((r: any) => roleMap.set(r.name, r.id));
    }
    return { teamMap, roleMap };
  }, [optionsData]);

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["users-paged", page, pageSize, apiFilters, sortKey, sortDirection], 
    queryFn: () => fetchUsers({ page, pageSize, filters, sortKey, sortDirection, maps }),
    placeholderData: (previousData) => previousData, 
    enabled: !!optionsData,
    refetchOnWindowFocus: false, 
  });

  const users = data?.results || [];
  const totalCount = data?.total_count || 0;
  const totalPages = data?.total_pages || 1;

  const groupedByTeam = useMemo(() => {
    if (!users.length) return [];
    
    const map: Record<string, User[]> = {};
    users.forEach((u: User) => {
      const key = u.team_name || "Untitled Team";
      if (!map[key]) map[key] = [];
      map[key].push(u);
    });

    const uniqueTeams = Array.from(new Set(users.map((u: User) => u.team_name || "Untitled Team")));
    return uniqueTeams.map((teamName) => ({
      teamName: teamName as string,
      users: map[teamName as string] || []
    }));
  }, [users]);

  const handleFilterChange = (newFilters: UserFiltersValue) => {
    setFilters(newFilters);
    setPage(1);
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
  };

  return (
    <div className="flex flex-col gap-4 text-neutral-200">
      <UserFilters
        value={filters}
        options={{
          totalCount: totalCount, 
          allTeams: optionsData?.teams?.map((t:any) => t.name).sort() || [],
          allRoles: optionsData?.roles?.map((r:any) => r.name).sort() || [],
          allStatuses: optionsData?.statuses || [],
        }}
        isLoading={isFetching}
        onChange={handleFilterChange}
        onClear={clearAllFilters}
      />

      <div className="flex flex-col gap-2">
        <div className="rounded-md border border-neutral-800 overflow-auto relative min-h-[69vh] max-h-[69vh]">
          <Table className="min-w-[900px]">
            <TableHeader >
              <TableHeaderRow className="">
                <SortableHead
                  sorted={sortKey === "name"}
                  direction={sortDirection}
                  onClick={() => handleHeaderClick("name")}
                >
                  Name
                </SortableHead>

                <SortableHead
                  sorted={sortKey === "role"}
                  direction={sortDirection}
                  onClick={() => handleHeaderClick("role")}
                >
                  Role
                </SortableHead>

                <SortableHead
                  sorted={sortKey === "email"}
                  direction={sortDirection}
                  onClick={() => handleHeaderClick("email")}
                >
                  Email
                </SortableHead>

                <SortableHead
                  sorted={sortKey === "status"}
                  direction={sortDirection}
                  onClick={() => handleHeaderClick("status")}
                >
                  Status
                </SortableHead>

                <TableHead className="text-center">Actions</TableHead>
              </TableHeaderRow>
            </TableHeader>

            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-neutral-500">
                    Loading data...
                  </TableCell>
                </TableRow>
              ) : groupedByTeam.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-10 text-neutral-500">
                    No users found.
                  </TableCell>
                </TableRow>
              ) : (
                groupedByTeam.map(({ teamName, users }) => (
                  <Fragment key={teamName}>
                    <TableGroupRow>
                      <TableGroupCell colSpan={5}>
                         <span className="font-semibold text-neutral-300">{teamName}</span>
                      </TableGroupCell>
                    </TableGroupRow>

                    {users.map((u) => {
                      const isSelf = typeof currentUserId === "number" && u.id === currentUserId;
                      // Determine Role Pill Props from our map
                      const roleProps = getRolePillProps(u.role_name);

                      return (
                        <TableRow key={u.id}>
                          <TableCell>
                            <div className="flex items-center gap-2 h-7">
                              {u.photo_url ? (
                                <Image
                                  src={u.photo_url}
                                  alt=""
                                  width={24}
                                  height={24}
                                  className="h-6 w-6 rounded object-cover"
                                />
                              ) : (
                                <div className="h-6 w-6 rounded bg-neutral-700 flex items-center justify-center text-[10px]">
                                  {u.first_name[0]}
                                </div>
                              )}

                              <div className="flex items-center gap-1 max-w-full">
                                <span className="whitespace-nowrap overflow-hidden text-ellipsis">
                                  {u.first_name} {u.last_name}
                                </span>
                                {isSelf && (
                                  <span className="text-[10px] text-neutral-400 shrink-0">
                                    (You)
                                  </span>
                                )}
                              </div>
                            </div>
                          </TableCell>

                          {/* --- Role Pill Usage --- */}
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

                          <TableCell>
                            <span className="whitespace-nowrap overflow-hidden text-ellipsis block">
                              {u.email}
                            </span>
                          </TableCell>

                          {/* --- Status Pill Usage --- */}
                          <TableCell>
                            {u.is_active === "active" ? (
                              <Pill bg="bg-green-900/30" text="text-green-400" border="border-green-700/40">
                                Active
                              </Pill>
                            ) : u.is_active === "pending" ? (
                              <Pill bg="bg-yellow-900/30" text="text-yellow-400" border="border-yellow-700/40">
                                Pending
                              </Pill>
                            ) : (
                              <Pill bg="bg-zinc-900/30" text="text-zinc-400" border="border-zinc-700/40">
                                Inactive
                              </Pill>
                            )}
                          </TableCell>

                          <TableCell className="text-center">
                            <div className="flex items-center justify-center gap-3 h-7">
                              {u.is_active === "pending" ? (
                                <>
                                  <button
                                    onClick={() => onApprove(u)}
                                    className="text-green-400 hover:text-green-300 cursor-pointer"
                                    title="Approve user"
                                  >
                                    <Check size={18} />
                                  </button>

                                  <button
                                    onClick={() => onReject(u)}
                                    className="text-red-400 hover:text-red-300 cursor-pointer"
                                    title="Reject user"
                                  >
                                    <X size={18} />
                                  </button>
                                </>
                              ) : (
                                <button
                                  onClick={() => onEdit(u)}
                                  className="text-blue-300 hover:text-blue-200 cursor-pointer"
                                  title="Edit user"
                                >
                                  <Pencil size={18} />
                                </button>
                              )}
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </Fragment>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        {/* --- Pagination Footer --- */}
        <Card className="px-4 py-1.5">
          <Pagination
            page={page}
            totalPages={totalPages}
            totalCount={totalCount}
            pageSize={pageSize} 
            rangeStart={(page - 1) * pageSize + 1} 
            rangeEnd={Math.min(page * pageSize, totalCount)} 
            onPageChange={setPage}
            onPageSizeChange={(newSize) => { 
              setPageSize(newSize);
              setPage(1); 
            }}
          />
        </Card>
      </div>
    </div>
  );
}