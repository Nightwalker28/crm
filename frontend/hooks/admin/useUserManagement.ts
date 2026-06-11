"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";
import type { User } from "@/components/users/userManagementTable";

type UserOption = { id: number; name: string };
type AuthMode = "manual_only" | "manual_or_google";
type UserStatus = "active" | "inactive";
export type MfaPolicy = "off" | "admins_only" | "all_users";

export type UserOptionsData = {
  roles: UserOption[];
  teams: UserOption[];
  statuses: string[];
};

export type CreateUserForm = {
  first_name: string;
  last_name: string;
  email: string;
  role_id: number;
  team_id: number;
  auth_mode: AuthMode;
  is_active: UserStatus;
};

type CreateUserResult = {
  setup_link?: string | null;
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
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    refetchOnMount: true,
  });

  const mfaPolicyQuery = useQuery<{ policy: MfaPolicy }>({
    queryKey: ["admin-mfa-policy"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/mfa-policy");
      if (!res.ok) throw new Error("Failed to fetch MFA policy");
      return res.json();
    },
    staleTime: 1000 * 60 * 5,
    refetchOnWindowFocus: false,
  });

  const updateMfaPolicyMutation = useMutation({
    mutationFn: async (policy: MfaPolicy) => {
      const res = await apiFetch("/admin/users/mfa-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["admin-mfa-policy"] }),
        queryClient.invalidateQueries({ queryKey: ["users-paged"] }),
      ]);
      toast.success("MFA policy updated.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to update MFA policy.");
    },
  });

  const resetUserMfaMutation = useMutation({
    mutationFn: async (userId: number) => {
      const res = await apiFetch(`/admin/users/${userId}/mfa-reset`, {
        method: "POST",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
      }
      return res.json();
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
      toast.success("MFA reset.");
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : "Failed to reset MFA.");
    },
  });

  async function refreshUsers() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["users-paged"] }),
      queryClient.invalidateQueries({ queryKey: ["user-options"] }),
      queryClient.refetchQueries({ queryKey: ["users-paged"], type: "active" }),
      queryClient.refetchQueries({ queryKey: ["user-options"], type: "active" }),
    ]);
  }

  async function createUser(form: CreateUserForm): Promise<CreateUserResult> {
    const res = await apiFetch("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok) {
      throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
    }

    await refreshUsers();
    toast.success("User created.");
    return {
      setup_link: body?.setup_link ?? null,
    };
  }

  async function updateUser(id: number, form: Partial<User>) {
    const res = await apiFetch(`/admin/users/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new Error(body?.detail ?? body?.message ?? `Status ${res.status}`);
    }

    await refreshUsers();
    toast.success("User updated.");
  }

  function openEditModal(user: User) {
    setEditUserData(user);
    setIsEditOpen(true);
  }

  function closeEditModal() {
    setIsEditOpen(false);
    setEditUserData(null);
  }

  function openCreateModal() {
    setIsCreateOpen(true);
  }

  function closeCreateModal() {
    setIsCreateOpen(false);
  }

  return {
    currentUserId,
    editUserData,
    isEditOpen,
    isCreateOpen,
    optionsData: optionsQuery.data ?? EMPTY_USER_OPTIONS,
    mfaPolicy: mfaPolicyQuery.data?.policy ?? "off",
    isMfaPolicyLoading: mfaPolicyQuery.isLoading,
    isMfaPolicySaving: updateMfaPolicyMutation.isPending,
    roles: optionsQuery.data?.roles ?? EMPTY_USER_OPTIONS.roles,
    teams: optionsQuery.data?.teams ?? EMPTY_USER_OPTIONS.teams,
    openEditModal,
    closeEditModal,
    openCreateModal,
    closeCreateModal,
    createUser,
    updateUser,
    updateMfaPolicy: (policy: MfaPolicy) => updateMfaPolicyMutation.mutate(policy),
    resetUserMfa: (userId: number) => resetUserMfaMutation.mutateAsync(userId),
    isResettingUserMfa: resetUserMfaMutation.isPending,
  };
}
