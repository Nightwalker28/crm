"use client";

import { Linkedin, Mail } from "lucide-react";
import type { Contact } from "@/hooks/sales/useContacts";

interface ContactListProps {
  contacts: Contact[];
  isLoading: boolean;
}

export default function ContactList({
  contacts,
  isLoading,
}: ContactListProps) {
  return (
    <div
      className="
        border border-zinc-800 rounded-lg
        bg-zinc-900/40
        overflow-y-auto
      "
    >
      {isLoading ? (
        <div className="p-6 text-sm text-zinc-400">
          Loading contacts…
        </div>
      ) : contacts.length === 0 ? (
        <div className="p-6 text-sm text-zinc-400">
          No contacts found.
        </div>
      ) : (
        <div className="divide-y divide-zinc-800">
          {contacts.map((c) => (
            <div
              key={c.contact_id}
              className="flex items-center justify-between px-4 py-3 hover:bg-zinc-900/60 transition"
            >
              {/* LEFT */}
              <div className="flex flex-col min-w-0 gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-zinc-100 truncate">
                    {c.first_name || "-"} {c.last_name || ""}
                  </span>

                  {c.linkedin_url && (
                    <a
                      href={`https://${c.linkedin_url}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[#0A66C2] hover:text-[#0A66C2]/80"
                      title="LinkedIn"
                    >
                      <Linkedin size={15} />
                    </a>
                  )}
                </div>

                <div className="text-sm text-zinc-400 truncate">
                  {c.current_title || "No title"} ·{" "}
                  {c.region || "Unknown region"}
                </div>
              </div>

              {/* RIGHT */}
              <div className="flex items-center gap-3 shrink-0">
                {c.primary_email && (
                  <a
                    href={`mailto:${c.primary_email}`}
                    className="flex items-center gap-1 text-sm text-zinc-400 hover:text-zinc-200"
                    title="Send email"
                  >
                    <Mail size={14} />
                    <span className="hidden md:inline">
                      {c.primary_email}
                    </span>
                  </a>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}