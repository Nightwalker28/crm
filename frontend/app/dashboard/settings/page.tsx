import Link from "next/link";
import {
  Activity,
  ArrowRight,
  Blocks,
  Building2,
  BadgePercent,
  FileText,
  KeyRound,
  Plug,
  Recycle,
  Settings2,
  ShieldCheck,
  UsersRound,
  Wrench,
} from "lucide-react";

import { PageHeader } from "@/components/ui/PageHeader";
import { SETTINGS_ROUTES } from "@/lib/routes";

const SETTINGS_SECTIONS = [
  {
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
    ],
  },
  {
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
    title: "Danger Zone",
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
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Settings"
        description="Manage company setup, users, access control, modules, integrations, templates, and platform configuration."
      />

      <div className="grid gap-6">
        {SETTINGS_SECTIONS.map((section) => (
          <section key={section.title} className="grid gap-3">
            <h2 className={section.title === "Danger Zone" ? "text-sm font-semibold uppercase tracking-[0.16em] text-red-500/80" : "text-sm font-semibold uppercase tracking-[0.16em] text-neutral-500"}>{section.title}</h2>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="group rounded-md border border-neutral-800 bg-neutral-950/60 px-4 py-4 transition-colors hover:border-neutral-700 hover:bg-neutral-900/60"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 gap-3">
                        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-white/10 bg-white/[0.04] text-neutral-300">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-neutral-100">{item.title}</span>
                          <span className="mt-1 block text-sm leading-6 text-neutral-400">{item.description}</span>
                        </span>
                      </div>
                      <span className="mt-1 flex shrink-0 items-center gap-1 text-xs font-medium text-neutral-500 transition-colors group-hover:text-neutral-200">
                        Open
                        <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                      </span>
                    </div>
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
