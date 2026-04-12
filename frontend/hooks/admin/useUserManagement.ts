"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { User } from "@/components/users/userManagementTable";

type UserOption = { id: number; name: string };

export type UserOptionsData = {
  roles: UserOption[];
  teams: UserOption[];
  statuses: string[];
};

const EMPTY_USER_OPTIONS: UserOptionsData = {
  roles: [],
  teams: [],
  statuses: [],
};

type StoredUser = {
  id?: unknown;
};

function parseStoredUser(raw: string | null): number | null {
  if (!raw) return null;

  try {
    const parsed: StoredUser = JSON.parse(raw);
    return typeof parsed.id === "number" ? parsed.id : null;
  } catch (error) {
    console.error("Invalid lynk_user format", error);
    return null;
  }
}

export function useUserManagement() {
  const queryClient = useQueryClient();

  const [currentUserId, setCurrentUserId] = useState<number | null>(null);

  const [editUserData, setEditUserData] = useState<User | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);

  const [approveUserData, setApproveUserData] = useState<User | null>(null);
  const [isApproveOpen, setIsApproveOpen] = useState(false);

  const [rejectUserData, setRejectUserData] = useState<User | null>(null);
  const [isRejectOpen, setIsRejectOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    setCurrentUserId(parseStoredUser(sessionStorage.getItem("lynk_user")));
  }, []);

  const optionsQuery = useQuery<UserOptionsData>({
    queryKey: ["user-options"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/options");
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  async function refreshUsers() {
    await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
  }

  async function approveUser(id: number, roleId: number, teamId: number) {
    try {
      const res = await apiFetch(`/admin/users/approve/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: roleId, team_id: teamId }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      await refreshUsers();
      toast.success("User has been approved.");
    } catch (error) {
      console.error(error);
      toast.error("You ran into an error");
    }
  }

  async function rejectUser(id: number) {
    try {
      const res = await apiFetch(`/admin/users/pending/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      await refreshUsers();
      toast.success("User has been rejected.");
    } catch (error) {
      console.error(error);
      toast.error("You ran into an error");
    }
  }

  async function updateUser(id: number, form: Partial<User>) {
    try {
      const res = await apiFetch(`/admin/users/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      await refreshUsers();
      toast.success("User has been updated.");
    } catch (error) {
      console.error(error);
      toast.error("You ran into an error");
    }
  }

  function openEditModal(user: User) {
    setEditUserData(user);
    setIsEditOpen(true);
  }

  function closeEditModal() {
    setIsEditOpen(false);
  }

  function openApproveModal(user: User) {
    setApproveUserData(user);
    setIsApproveOpen(true);
  }

  function closeApproveModal() {
    setIsApproveOpen(false);
    setApproveUserData(null);
  }

  function openRejectModal(user: User) {
    setRejectUserData(user);
    setIsRejectOpen(true);
  }

  function closeRejectModal() {
    setIsRejectOpen(false);
    setRejectUserData(null);
  }

  return {
    currentUserId,
    editUserData,
    isEditOpen,
    approveUserData,
    isApproveOpen,
    rejectUserData,
    isRejectOpen,
    optionsData: optionsQuery.data ?? EMPTY_USER_OPTIONS,
    roles: optionsQuery.data?.roles ?? EMPTY_USER_OPTIONS.roles,
    teams: optionsQuery.data?.teams ?? EMPTY_USER_OPTIONS.teams,
    openEditModal,
    closeEditModal,
    openApproveModal,
    closeApproveModal,
    openRejectModal,
    closeRejectModal,
    approveUser,
    rejectUser,
    updateUser,
  };
}
