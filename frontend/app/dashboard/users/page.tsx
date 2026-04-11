"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { useQueryClient, useQuery } from "@tanstack/react-query";

import { apiFetch } from "@/lib/api";

import {
  UserManagementTable,
  type User,
} from "@/components/users/userManagementTable";

import EditUserDialog from "@/components/users/editUserDialog";
import ApproveUserDialog from "@/components/users/approveUserDialog";
import RejectUserDialog from "@/components/users/rejectUserDialog";

export default function UserManagementPage() {
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

    const raw = sessionStorage.getItem("lynk_user");
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.id === "number") setCurrentUserId(parsed.id);
    } catch (err) {
      console.error("Invalid lynk_user format", err);
    }
  }, []);

  // --- Dialog Handlers ---
  const openEditModal = (user: User) => {
    setEditUserData(user);
    setIsEditOpen(true);
  };
  const closeEditModal = () => setIsEditOpen(false);

  const openApproveModal = (user: User) => {
    setApproveUserData(user);
    setIsApproveOpen(true);
  };
  const closeApproveModal = () => {
    setIsApproveOpen(false);
    setApproveUserData(null);
  };

  const openRejectModal = (user: User) => {
    setRejectUserData(user);
    setIsRejectOpen(true);
  };
  const closeRejectModal = () => {
    setIsRejectOpen(false);
    setRejectUserData(null);
  };

  // --- Mutations ---
  async function approveUser(id: number, roleId: number, teamId: number) {
    try {
      const res = await apiFetch(`/admin/users/approve/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role_id: roleId, team_id: teamId }),
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
      toast.success("User has been approved.");
    } catch (e) {
      console.error(e);
      toast.error("You ran into an error");
    }
  }

  async function rejectUser(id: number) {
    try {
      const res = await apiFetch(`/admin/users/pending/${id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error(`Status ${res.status}`);

      await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
      toast.success("User has been rejected.");
    } catch (e) {
      console.error(e);
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

      await queryClient.invalidateQueries({ queryKey: ["users-paged"] });
      toast.success("User has been updated.");
    } catch (e) {
      console.error(e);
      toast.error("You ran into an error");
    }
  }

  const { data: optionsData } = useQuery({
    queryKey: ["user-options"],
    queryFn: async () => {
      const res = await apiFetch("/admin/users/options");
      if (!res.ok) throw new Error("Failed to fetch options");
      return res.json();
    },
    staleTime: 1000 * 60 * 10,
    refetchOnWindowFocus: false,
  });

  const roles = optionsData?.roles ?? [];
  const teams = optionsData?.teams ?? [];


  return (
    <div className="flex flex-col gap-5 text-neutral-200">
      <h1 className="text-2xl font-semibold leading-none">User Management</h1>

      <UserManagementTable
        currentUserId={currentUserId}
        optionsData={optionsData}
        onApprove={openApproveModal}
        onReject={openRejectModal}
        onEdit={openEditModal}
      />

      {editUserData && (
        <EditUserDialog
          open={isEditOpen}
          user={editUserData}
          roles={roles}
          teams={teams}
          currentUserId={currentUserId}
          onClose={closeEditModal}
          onSave={(id, form) => {
            updateUser(id, form);
            closeEditModal();
          }}
        />
      )}

      {approveUserData && (
        <ApproveUserDialog
          open={isApproveOpen}
          user={approveUserData}
          roles={roles}
          teams={teams}
          onClose={closeApproveModal}
          onApprove={async (id, roleId, teamId) => {
            await approveUser(id, roleId, teamId);
            closeApproveModal();
          }}
        />
      )}

      {rejectUserData && (
        <RejectUserDialog
          open={isRejectOpen}
          user={rejectUserData}
          onCancel={closeRejectModal}
          onConfirm={async () => {
            await rejectUser(rejectUserData.id);
            closeRejectModal();
          }}
        />
      )}
    </div>
  );
}
