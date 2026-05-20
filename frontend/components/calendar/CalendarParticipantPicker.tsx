"use client";

import { useMemo } from "react";

import { UserTeamPicker } from "@/components/ui/UserTeamPicker";
import type {
  CalendarAssignmentTeamOption,
  CalendarAssignmentUserOption,
  CalendarParticipantInput,
} from "@/hooks/useCalendar";

type Props = {
  users: CalendarAssignmentUserOption[];
  teams: CalendarAssignmentTeamOption[];
  value: CalendarParticipantInput[];
  onChange: (value: CalendarParticipantInput[]) => void;
  disabled?: boolean;
};

function hasParticipant(
  participants: CalendarParticipantInput[],
  participantType: CalendarParticipantInput["participant_type"],
  targetId: number,
) {
  return participants.some((participant) =>
    participant.participant_type === participantType &&
    (participantType === "user" ? participant.user_id === targetId : participant.team_id === targetId),
  );
}

function toggleParticipant(
  participants: CalendarParticipantInput[],
  participantType: CalendarParticipantInput["participant_type"],
  targetId: number,
): CalendarParticipantInput[] {
  if (hasParticipant(participants, participantType, targetId)) {
    return participants.filter((participant) =>
      participantType === "user"
        ? !(participant.participant_type === "user" && participant.user_id === targetId)
        : !(participant.participant_type === "team" && participant.team_id === targetId),
    );
  }

  return [
    ...participants,
    participantType === "user"
      ? { participant_type: "user" as const, user_id: targetId, team_id: null }
      : { participant_type: "team" as const, team_id: targetId, user_id: null },
  ];
}

export default function CalendarParticipantPicker({
  users,
  teams,
  value,
  onChange,
  disabled = false,
}: Props) {
  const selectedEntries = useMemo(() => {
    return value
      .map((participant) => {
        if (participant.participant_type === "user" && participant.user_id) {
          const user = users.find((candidate) => candidate.id === participant.user_id);
          if (!user) return null;
          return { key: `user-${user.id}`, type: "user" as const, id: user.id, label: user.name, typeLabel: "User Invite" };
        }
        if (participant.participant_type === "team" && participant.team_id) {
          const team = teams.find((candidate) => candidate.id === participant.team_id);
          if (!team) return null;
          return { key: `team-${team.id}`, type: "team" as const, id: team.id, label: team.name, typeLabel: "Team Share" };
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
      isSelected={(type, id) => hasParticipant(value, type, id)}
      onToggle={(type, id) => onChange(toggleParticipant(value, type, id))}
      disabled={disabled}
      selectedSummary={(count) => `${count} invitee${count === 1 ? "" : "s"} selected`}
      emptySelectedText="No additional invitees selected."
      initialHelpText="Start typing to find users or teams to include."
      noResultsText="No calendar participants matched that search."
      teamDescription="Team-shared events appear for current team members immediately."
    />
  );
}
