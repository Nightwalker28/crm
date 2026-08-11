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
import { SETTINGS_ROUTES } from "@/lib/routes";

const SETTINGS_SECTIONS = [
  {
    key: "workspace",
    title: "Workspace",
    items: [
      {
        title: "General",
        description: "Manage company profile and tenant setup.",
        href: SETTINGS_ROUTES.general,
        icon: Building2,
      },
      { title: "Booking Links", description: "Manage public scheduling links and booking availability.", href: SETTINGS_ROUTES.calendarBooking, icon: CalendarDays },
    ],
  },
  {
    key: "users-organization",
    title: "Users and organization",
    items: [
      { title: "Users", description: "Invite users, manage accounts, and keep access current.", href: SETTINGS_ROUTES.users, icon: UsersRound },
      { title: "Teams", description: "Organize departments and team membership.", href: SETTINGS_ROUTES.teams, icon: Blocks },
      { title: "Customer Groups", description: "Review customer segmentation used by contacts, accounts, and client portal context.", href: SETTINGS_ROUTES.customerGroups, icon: BadgePercent },
    ],
  },
  {
    key: "security-access",
    title: "Security and access",
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
      { title: "Authentication", description: "Configure MFA, password policy, and tenant SSO.", href: SETTINGS_ROUTES.authentication, icon: ShieldCheck },
      { title: "Domains", description: "Verify workspace domains for tenant sign-in.", href: SETTINGS_ROUTES.domains, icon: ShieldCheck },
      { title: "Provisioning", description: "Map verified identities to roles and teams.", href: SETTINGS_ROUTES.provisioning, icon: UsersRound },
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
    ],
  },
  {
    key: "integrations",
    title: "Integrations",
    items: [
      {
        title: "Integrations",
        description: "Connect platform services and operational feeds.",
        href: SETTINGS_ROUTES.integrations,
        icon: Plug,
      },
    ],
  },
  {
    key: "data-maintenance",
    title: "Data and maintenance",
    items: [
      { title: "Backups", description: "Configure tenant-scoped backup exports and retention.", href: SETTINGS_ROUTES.backups, icon: Database },
      { title: "Activity Log", description: "Review audited writes, restores, and configuration events.", href: SETTINGS_ROUTES.activityLog, icon: Activity },
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
      <div className="grid gap-6">
        {SETTINGS_SECTIONS.map((section) => (
          <section key={section.key} aria-labelledby={`${section.key}-heading`}>
            <Card>
              <div className="border-b border-line-subtle px-5 py-4">
                <h2
                  id={`${section.key}-heading`}
                  className="text-sm font-semibold text-copy-primary"
                >
                  {section.title}
                </h2>
              </div>
              <nav aria-label={`${section.title} settings`}>
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-4 transition-colors last:border-b-0 hover:bg-surface-muted focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <span
                          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-copy-secondary"
                        >
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-copy-primary">{item.title}</span>
                          <span className="mt-1 block text-p-sm text-copy-muted">{item.description}</span>
                        </span>
                      </span>
                      <ArrowRight className="h-4 w-4 shrink-0 text-copy-muted transition-transform group-hover:translate-x-0.5 group-hover:text-copy-primary" />
                    </Link>
                  );
                })}
              </nav>
            </Card>
          </section>
        ))}
      </div>
    </div>
  );
}
