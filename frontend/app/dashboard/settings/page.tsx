import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { PageShell } from "@/components/ui/PageShell";
import { SETTINGS_NAV_GROUPS } from "@/lib/module-registry";

/**
 * The settings index. It held 180 lines of its own information architecture — a second,
 * grouped copy of `SETTINGS_NAV_ITEMS` that disagreed with it about `record-layouts`. It
 * now renders `SETTINGS_NAV_GROUPS`, which is also what the rail and the command palette
 * read, so the two lists cannot drift again (rebuild.md 5.6, ruling 2).
 *
 * It survives the rail rather than redirecting to `general`: it is where the sidebar's one
 * `Settings` entry lands, where every route state's "Back to settings" goes, and where the
 * one-line descriptions live that a 16rem rail has no room for. Below `lg`, where the rail
 * is not drawn, it is the only index.
 */
export default function SettingsPage() {
  return (
    <PageShell variant="settings" title="Settings" description="Configure the workspace, its users, and the modules they can reach.">
      <div data-slot="settings-hub" className="grid gap-6">
        {SETTINGS_NAV_GROUPS.map((group) => (
          <section key={group.key} aria-labelledby={`${group.key}-heading`}>
            <Card>
              <div className="border-b border-line-subtle px-5 py-4">
                <h2 id={`${group.key}-heading`} className="text-sm font-semibold text-copy-primary">
                  {group.title}
                </h2>
              </div>
              <nav aria-label={`${group.title} settings`}>
                {group.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="group flex items-center justify-between gap-4 border-b border-line-subtle px-5 py-4 transition-colors last:border-b-0 hover:bg-surface-muted focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus"
                    >
                      <span className="flex min-w-0 items-start gap-3">
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted text-copy-secondary">
                          <Icon className="h-4 w-4" />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-sm font-semibold text-copy-primary">{item.label}</span>
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
    </PageShell>
  );
}
