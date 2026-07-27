import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Blocks,
  Building2,
  BadgePercent,
  CalendarDays,
  Database,
  FileText,
  KeyRound,
  Plug,
  Recycle,
  Repeat2,
  Settings2,
  ShieldCheck,
  UsersRound,
  Wrench,
} from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageHeader } from "@/components/ui/PageHeader";
import { SETTINGS_ROUTES } from "@/lib/routes";

const SETTINGS_SECTIONS = [
  {
    key: "organization",
    title: "Organization",
    items: [
      {
        title: "General",
        description: "Manage company profile and tenant setup.",
        href: SETTINGS_ROUTES.general,
        icon: Building2,
      },
      {
        title: "User Management",
        description: "Invite users, manage accounts, and keep access current.",
        href: SETTINGS_ROUTES.users,
        icon: UsersRound,
      },
      {
        title: "Teams",
        description: "Organize departments and team membership.",
        href: SETTINGS_ROUTES.teams,
        icon: Blocks,
      },
      {
        title: "Customer Groups",
        description: "Review customer segmentation used by contacts, accounts, and client portal context.",
        href: SETTINGS_ROUTES.customerGroups,
        icon: BadgePercent,
      },
    ],
  },
  {
    key: "access-control",
    title: "Access Control",
    items: [
      {
        title: "Permissions",
        description: "Control role actions across enabled modules.",
        href: SETTINGS_ROUTES.permissions,
        icon: ShieldCheck,
      },
      {
        title: "Module Settings",
        description: "Enable modules and assign department or team access.",
        href: SETTINGS_ROUTES.modules,
        icon: KeyRound,
      },
    ],
  },
  {
    key: "customization",
    title: "Customization",
    items: [
      {
        title: "Module Builder",
        description: "Create and maintain custom module definitions.",
        href: SETTINGS_ROUTES.moduleBuilder,
        icon: Wrench,
      },
      {
        title: "Field Config",
        description: "Add configurable fields to supported modules.",
        href: SETTINGS_ROUTES.fields,
        icon: Settings2,
      },
      {
        title: "Templates",
        description: "Manage reusable message templates.",
        href: SETTINGS_ROUTES.templates,
        icon: FileText,
      },
      {
        title: "Automation",
        description: "Configure event-based workflow rules and review run history.",
        href: SETTINGS_ROUTES.automation,
        icon: Repeat2,
      },
      {
        title: "Booking Links",
        description: "Manage public scheduling links and booking availability.",
        href: SETTINGS_ROUTES.calendarBooking,
        icon: CalendarDays,
      },
      {
        title: "Backups",
        description: "Configure tenant-scoped backup exports and retention.",
        href: SETTINGS_ROUTES.backups,
        icon: Database,
      },
    ],
  },
  {
    key: "system",
    title: "System",
    items: [
      {
        title: "Integrations",
        description: "Connect platform services and operational feeds.",
        href: SETTINGS_ROUTES.integrations,
        icon: Plug,
      },
      {
        title: "Activity Log",
        description: "Review audited writes, restores, and configuration events.",
        href: SETTINGS_ROUTES.activityLog,
        icon: Activity,
      },
    ],
  },
  {
    key: "danger-zone",
    title: "Danger Zone",
    danger: true,
    items: [
      {
        title: "Recycle Bin",
        description: "Restore recoverable records from one place.",
        href: SETTINGS_ROUTES.recycleBin,
        icon: Recycle,
      },
    ],
  },
];

export default function SettingsPage() {
  return (
    <div className="flex flex-col gap-6 text-copy-secondary">
      <PageHeader
        title="Settings"
        description="Manage company setup, users, access control, modules, integrations, templates, and platform configuration."
      />

      <div className="grid gap-6">
        {SETTINGS_SECTIONS.map((section) => (
          <section key={section.key} className="grid gap-3" aria-labelledby={`${section.key}-heading`}>
            <h2
              id={`${section.key}-heading`}
              className={`text-sm font-semibold uppercase tracking-[0.16em] ${
                section.danger ? "text-state-danger" : "text-copy-muted"
              }`}
            >
              {section.title}
            </h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group rounded-[var(--radius-card)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-app"
                  >
                    <Card
                      variant="interactive"
                      className={`flex h-full items-start justify-between gap-3 px-5 py-5 ${
                        section.danger ? "border-state-danger/30 hover:border-state-danger/60" : ""
                      }`}
                    >
                      <div className="flex min-w-0 gap-3">
                        <span
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border ${
                            section.danger
                              ? "border-state-danger/40 bg-state-danger-muted text-state-danger"
                              : "border-line-default bg-surface-muted text-copy-secondary"
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-copy-primary">{item.title}</span>
                          <span className="mt-1 block text-sm leading-6 text-copy-muted">{item.description}</span>
                        </span>
                      </div>
                      <span className="mt-1 flex shrink-0 items-center gap-1 text-xs font-medium text-copy-muted transition-colors group-hover:text-copy-primary">
                        Open
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </Card>
                  </Link>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
