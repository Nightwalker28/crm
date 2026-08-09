"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { useConfirm } from "@/hooks/useConfirm";
import { apiFetch } from "@/lib/api";

export type Department = {
  id: number;
  name: string;
  description?: string | null;
};

export type Team = {
  id: number;
  name: string;
  description?: string | null;
  department_id?: number | null;
};

export type DepartmentForm = {
  name: string;
  description: string;
};

export type TeamForm = {
  name: string;
  description: string;
  department_id: string;
};

export const emptyDepartmentForm: DepartmentForm = {
  name: "",
  description: "",
};

export const emptyTeamForm: TeamForm = {
  name: "",
  description: "",
  department_id: "",
};

const emptyDepartments: Department[] = [];
const emptyTeams: Team[] = [];

async function fetchDepartments(): Promise<Department[]> {
  const res = await apiFetch("/admin/users/departments");
  if (!res.ok) throw new Error("request-failed");
  return res.json();
}

async function fetchTeams(): Promise<Team[]> {
  const res = await apiFetch("/admin/users/teams");
  if (!res.ok) throw new Error("request-failed");
  return res.json();
}

export function useTeamsAndDepartments() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();

  const [error, setError] = useState<string | null>(null);
  const [departmentDialogOpen, setDepartmentDialogOpen] = useState(false);
  const [teamDialogOpen, setTeamDialogOpen] = useState(false);
  const [departmentMode, setDepartmentMode] = useState<"create" | "edit">("create");
  const [teamMode, setTeamMode] = useState<"create" | "edit">("create");
  const [editingDepartmentId, setEditingDepartmentId] = useState<number | null>(null);
  const [editingTeamId, setEditingTeamId] = useState<number | null>(null);
  const [departmentSubmitting, setDepartmentSubmitting] = useState(false);
  const [teamSubmitting, setTeamSubmitting] = useState(false);
  const [departmentForm, setDepartmentForm] = useState<DepartmentForm>(emptyDepartmentForm);
  const [teamForm, setTeamForm] = useState<TeamForm>(emptyTeamForm);
  const [initialDepartmentForm, setInitialDepartmentForm] = useState<DepartmentForm>(emptyDepartmentForm);
  const [initialTeamForm, setInitialTeamForm] = useState<TeamForm>(emptyTeamForm);

  const departmentsQuery = useQuery({
    queryKey: ["admin-departments"],
    queryFn: fetchDepartments,
  });

  const teamsQuery = useQuery({
    queryKey: ["admin-teams"],
    queryFn: fetchTeams,
  });

  const departments = departmentsQuery.data ?? emptyDepartments;
  const teams = teamsQuery.data ?? emptyTeams;
  const departmentDirty =
    departmentForm.name !== initialDepartmentForm.name ||
    departmentForm.description !== initialDepartmentForm.description;
  const teamDirty =
    teamForm.name !== initialTeamForm.name ||
    teamForm.description !== initialTeamForm.description ||
    teamForm.department_id !== initialTeamForm.department_id;

  const groupedTeams = useMemo(() => {
    const grouped = departments.map((department) => ({
      department,
      teams: teams.filter((team) => team.department_id === department.id),
    }));

    const orphanedTeams = teams.filter(
      (team) => team.department_id == null || !departments.some((department) => department.id === team.department_id),
    );

    if (orphanedTeams.length > 0) {
      grouped.push({
        department: {
          id: -1,
          name: "Unassigned Department",
          description: "Teams with missing department links",
        },
        teams: orphanedTeams,
      });
    }

    return grouped;
  }, [departments, teams]);

  async function refreshData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["admin-departments"] }),
      queryClient.invalidateQueries({ queryKey: ["admin-teams"] }),
      queryClient.invalidateQueries({ queryKey: ["user-options"] }),
      queryClient.invalidateQueries({ queryKey: ["users-paged"] }),
    ]);
  }

  function openCreateDepartment() {
    setError(null);
    setDepartmentMode("create");
    setEditingDepartmentId(null);
    setDepartmentForm(emptyDepartmentForm);
    setInitialDepartmentForm(emptyDepartmentForm);
    setDepartmentDialogOpen(true);
  }

  function openEditDepartment(department: Department) {
    setError(null);
    setDepartmentMode("edit");
    setEditingDepartmentId(department.id);
    const nextForm = {
      name: department.name,
      description: department.description ?? "",
    };
    setDepartmentForm(nextForm);
    setInitialDepartmentForm(nextForm);
    setDepartmentDialogOpen(true);
  }

  function openCreateTeam(departmentId?: number) {
    setError(null);
    setTeamMode("create");
    setEditingTeamId(null);
    const nextForm = {
      ...emptyTeamForm,
      department_id:
        departmentId !== undefined
          ? String(departmentId)
          : departments[0]
            ? String(departments[0].id)
            : "",
    };
    setTeamForm(nextForm);
    setInitialTeamForm(nextForm);
    setTeamDialogOpen(true);
  }

  function openEditTeam(team: Team) {
    setError(null);
    setTeamMode("edit");
    setEditingTeamId(team.id);
    const nextForm = {
      name: team.name,
      description: team.description ?? "",
      department_id: team.department_id ? String(team.department_id) : "",
    };
    setTeamForm(nextForm);
    setInitialTeamForm(nextForm);
    setTeamDialogOpen(true);
  }

  async function saveDepartment() {
    try {
      setDepartmentSubmitting(true);
      setError(null);

      const payload = {
        name: departmentForm.name.trim(),
        description: departmentForm.description.trim() || null,
      };

      const res =
        departmentMode === "create"
          ? await apiFetch("/admin/users/departments", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await apiFetch(`/admin/users/departments/${editingDepartmentId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

      if (!res.ok) {
        setError(
          res.status === 400
            ? "A department with this name already exists."
            : "We could not save this department. Try again.",
        );
        return false;
      }

      setDepartmentDialogOpen(false);
      setDepartmentForm(emptyDepartmentForm);
      setInitialDepartmentForm(emptyDepartmentForm);
      await refreshData();
      return true;
    } catch {
      setError("We could not save this department. Try again.");
      return false;
    } finally {
      setDepartmentSubmitting(false);
    }
  }

  async function saveTeam() {
    try {
      setTeamSubmitting(true);
      setError(null);

      const payload = {
        name: teamForm.name.trim(),
        description: teamForm.description.trim() || null,
        department_id: Number(teamForm.department_id),
      };

      const res =
        teamMode === "create"
          ? await apiFetch("/admin/users/teams", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            })
          : await apiFetch(`/admin/users/teams/${editingTeamId}`, {
              method: "PUT",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(payload),
            });

      if (!res.ok) {
        setError(
          res.status === 400
            ? "A team with this name already exists."
            : res.status === 404
              ? "The selected department is no longer available. Refresh and try again."
              : "We could not save this team. Try again.",
        );
        return false;
      }

      setTeamDialogOpen(false);
      setTeamForm(emptyTeamForm);
      setInitialTeamForm(emptyTeamForm);
      await refreshData();
      return true;
    } catch {
      setError("We could not save this team. Try again.");
      return false;
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function removeDepartment(department: Department) {
    const confirmed = await confirm({
      title: "Delete department?",
      description: `Permanently delete "${department.name}"? Departments with assigned teams cannot be deleted.`,
      confirmLabel: "Delete Department",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      setError(null);
      const res = await apiFetch(`/admin/users/departments/${department.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError(
          res.status === 400
            ? "Move or delete this department's teams before deleting it."
            : "We could not delete this department. Try again.",
        );
        return;
      }
      await refreshData();
    } catch {
      setError("We could not delete this department. Try again.");
    }
  }

  async function removeTeam(team: Team) {
    const confirmed = await confirm({
      title: "Delete team?",
      description: `Delete team "${team.name}"? Users assigned to it will become unassigned.`,
      confirmLabel: "Delete Team",
      variant: "destructive",
    });
    if (!confirmed) return;

    try {
      setError(null);
      const res = await apiFetch(`/admin/users/teams/${team.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        setError("We could not delete this team. Try again.");
        return;
      }
      await refreshData();
    } catch {
      setError("We could not delete this team. Try again.");
    }
  }

  return {
    departments,
    teams,
    groupedTeams,
    error,
    clearError: () => setError(null),
    loading: departmentsQuery.isLoading || teamsQuery.isLoading,
    refreshing: departmentsQuery.isFetching || teamsQuery.isFetching,
    loadError: Boolean(departmentsQuery.error || teamsQuery.error),
    retryLoad: async () => {
      await Promise.all([departmentsQuery.refetch(), teamsQuery.refetch()]);
    },
    departmentDirty,
    teamDirty,
    departmentDialogOpen,
    teamDialogOpen,
    departmentMode,
    teamMode,
    departmentSubmitting,
    teamSubmitting,
    departmentForm,
    teamForm,
    setDepartmentDialogOpen,
    setTeamDialogOpen,
    setDepartmentForm,
    setTeamForm,
    openCreateDepartment,
    openEditDepartment,
    openCreateTeam,
    openEditTeam,
    saveDepartment,
    saveTeam,
    removeDepartment,
    removeTeam,
  };
}
