"use client";

import { useMemo } from "react";

import { UserTeamPicker } from "@/components/ui/UserTeamPicker";
import type {
  TaskAssigneeInput,
  TaskAssignmentTeamOption,
  TaskAssignmentUserOption,
} from "@/hooks/useTasks";

type Props = {
  users: TaskAssignmentUserOption[];
  teams: TaskAssignmentTeamOption[];
  value: TaskAssigneeInput[];
  onChange: (value: TaskAssigneeInput[]) => void;
  disabled?: boolean;
};

function hasAssignee(
  assignees: TaskAssigneeInput[],
  assigneeType: TaskAssigneeInput["assignee_type"],
  targetId: number,
) {
  return assignees.some((assignee) =>
    assignee.assignee_type === assigneeType &&
    (assigneeType === "user" ? assignee.user_id === targetId : assignee.team_id === targetId),
  );
}

function toggleAssignee(
  assignees: TaskAssigneeInput[],
  assigneeType: TaskAssigneeInput["assignee_type"],
  targetId: number,
): TaskAssigneeInput[] {
  if (hasAssignee(assignees, assigneeType, targetId)) {
    return assignees.filter((assignee) =>
      assigneeType === "user"
        ? !(assignee.assignee_type === "user" && assignee.user_id === targetId)
        : !(assignee.assignee_type === "team" && assignee.team_id === targetId),
    );
  }

  return [
    ...assignees,
    assigneeType === "user"
      ? { assignee_type: "user" as const, user_id: targetId, team_id: null }
      : { assignee_type: "team" as const, team_id: targetId, user_id: null },
  ];
}

export default function TaskAssigneePicker({
  users,
  teams,
  value,
  onChange,
  disabled = false,
}: Props) {
  const selectedEntries = useMemo(() => {
    return value
      .map((assignee) => {
        if (assignee.assignee_type === "user" && assignee.user_id) {
          const user = users.find((candidate) => candidate.id === assignee.user_id);
          return {
            key: `user-${assignee.user_id}`,
            type: "user" as const,
            id: assignee.user_id,
            label: user?.name ?? `User #${assignee.user_id}`,
            typeLabel: "User",
          };
        }
        if (assignee.assignee_type === "team" && assignee.team_id) {
          const team = teams.find((candidate) => candidate.id === assignee.team_id);
          return {
            key: `team-${assignee.team_id}`,
            type: "team" as const,
            id: assignee.team_id,
            label: team?.name ?? `Team #${assignee.team_id}`,
            typeLabel: "Team",
          };
        }
        return null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  }, [teams, users, value]);

  return (
    <UserTeamPicker
      users={users}
      teams={teams}
      selectedEntries={selectedEntries}
      isSelected={(type, id) => hasAssignee(value, type, id)}
      onToggle={(type, id) => onChange(toggleAssignee(value, type, id))}
      disabled={disabled}
      selectedSummary={(count) => `${count} assignee${count === 1 ? "" : "s"} selected`}
      emptySelectedText="No assignees selected."
      initialHelpText="Start typing to find users or teams."
      noResultsText="No assignees matched that search."
      teamDescription="Team assignment notifies current team members."
      triggerLabel="Select task assignees"
      searchLabel="Search task assignees"
    />
  );
}
