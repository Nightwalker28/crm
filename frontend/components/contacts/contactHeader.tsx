"use client";

import { Button } from "@/components/ui/button";
import CreateContactModal from "./createContactModal";
import { Plus } from "lucide-react";

interface ContactsHeaderProps {
  onCreateClick: () => void;
}

export default function ContactsHeader({
  onCreateClick,
}: ContactsHeaderProps) {
  return (
    <div className="flex items-center justify-between">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-100">
          Contacts
        </h1>
        <p className="text-sm text-zinc-500 mt-1">
          View and manage contacts linked to organizations
        </p>
      </div>

      <div className="flex items-center gap-3">
        <Button onClick={onCreateClick}>
          <Plus />
          <span className="hidden sm:inline">Create</span>
        </Button>
      </div>
    </div>
  );
}