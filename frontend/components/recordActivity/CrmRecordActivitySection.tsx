"use client";

import RecordDocumentsPanel from "@/components/documents/RecordDocumentsPanel";
import FollowUpPanel from "@/components/recordActivity/FollowUpPanel";
import RecordActivityTimeline from "@/components/recordActivity/RecordActivityTimeline";
import RecordCommentsPanel from "@/components/recordActivity/RecordCommentsPanel";
import RecordTasksPanel from "@/components/recordActivity/RecordTasksPanel";
import { RecordTabs, type RecordTab } from "@/components/ui/RecordTabs";
import type { RecordModuleKey } from "@/types/record-activity";

type FollowUpConfig = {
  endpoint: string;
  lastContactedAt?: string | null;
  lastContactedChannel?: string | null;
  email?: string | null;
  phone?: string | null;
  onLogged?: () => Promise<void> | void;
};

type Props = {
  moduleKey: RecordModuleKey;
  entityId: string | number;
  recordLabel: string;
  taskSourceLabel?: string;
  className?: string;
  followUp?: FollowUpConfig;
};

export default function CrmRecordActivitySection({
  moduleKey,
  entityId,
  recordLabel,
  taskSourceLabel,
  className,
  followUp,
}: Props) {
  const entityKey = String(entityId);
  const tabs: RecordTab[] = [
    {
      id: "activity",
      label: "Activity",
      content: (
        <RecordActivityTimeline
          moduleKey={moduleKey}
          entityId={entityKey}
          description={`${recordLabel} create, update, delete, restore, and note history.`}
        />
      ),
    },
    {
      id: "notes",
      label: "Notes",
      content: <RecordCommentsPanel moduleKey={moduleKey} entityId={entityKey} />,
    },
    {
      id: "documents",
      label: "Documents",
      content: <RecordDocumentsPanel moduleKey={moduleKey} entityId={entityKey} />,
    },
    {
      id: "tasks",
      label: "Tasks",
      content: <RecordTasksPanel moduleKey={moduleKey} entityId={entityKey} sourceLabel={taskSourceLabel} />,
    },
  ];

  if (followUp) {
    tabs.push({
      id: "follow-up",
      label: "Follow-up",
      content: <FollowUpPanel {...followUp} />,
    });
  }

  return <RecordTabs className={className} tabs={tabs} />;
}
