"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

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

function getErrorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  return fallback;
}

async function fetchDepartments(): Promise<Department[]> {
  const res = await apiFetch("/admin/users/departments");
  if (!res.ok) throw new Error("Failed to load departments");
  return res.json();
}

async function fetchTeams(): Promise<Team[]> {
  const res = await apiFetch("/admin/users/teams");
  if (!res.ok) throw new Error("Failed to load teams");
  return res.json();
}

export function useTeamsAndDepartments() {
  const queryClient = useQueryClient();

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
    ]);
  }

  function openCreateDepartment() {
    setError(null);
    setDepartmentMode("create");
    setEditingDepartmentId(null);
    setDepartmentForm(emptyDepartmentForm);
    setDepartmentDialogOpen(true);
  }

  function openEditDepartment(department: Department) {
    setError(null);
    setDepartmentMode("edit");
    setEditingDepartmentId(department.id);
    setDepartmentForm({
      name: department.name,
      description: department.description ?? "",
    });
    setDepartmentDialogOpen(true);
  }

  function openCreateTeam() {
    setError(null);
    setTeamMode("create");
    setEditingTeamId(null);
    setTeamForm({
      ...emptyTeamForm,
      department_id: departments[0] ? String(departments[0].id) : "",
    });
    setTeamDialogOpen(true);
  }

  function openEditTeam(team: Team) {
    setError(null);
    setTeamMode("edit");
    setEditingTeamId(team.id);
    setTeamForm({
      name: team.name,
      description: team.description ?? "",
      department_id: team.department_id ? String(team.department_id) : "",
    });
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
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to save department");
      }

      setDepartmentDialogOpen(false);
      setDepartmentForm(emptyDepartmentForm);
      await refreshData();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to save department"));
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
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to save team");
      }

      setTeamDialogOpen(false);
      setTeamForm(emptyTeamForm);
      await refreshData();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to save team"));
    } finally {
      setTeamSubmitting(false);
    }
  }

  async function removeDepartment(department: Department) {
    const confirmed = window.confirm(`Delete department "${department.name}"?`);
    if (!confirmed) return;

    try {
      setError(null);
      const res = await apiFetch(`/admin/users/departments/${department.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to delete department");
      }
      await refreshData();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to delete department"));
    }
  }

  async function removeTeam(team: Team) {
    const confirmed = window.confirm(`Delete team "${team.name}"? Users assigned to it will become unassigned.`);
    if (!confirmed) return;

    try {
      setError(null);
      const res = await apiFetch(`/admin/users/teams/${team.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.detail ?? "Failed to delete team");
      }
      await refreshData();
    } catch (error: unknown) {
      setError(getErrorMessage(error, "Failed to delete team"));
    }
  }

  return {
    departments,
    teams,
    groupedTeams,
    error,
    loading: departmentsQuery.isLoading || teamsQuery.isLoading,
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
