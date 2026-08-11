"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, Building2, CalendarDays, FileText, HelpCircle, LogOut, MessageSquare, PackageSearch, ScrollText, ShoppingCart } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clearClientToken, useClientOverview, type ClientMe } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

const sections = [
  { key: "quotes", label: "Quotes", href: "/client/quotes", icon: ScrollText },
  { key: "orders", label: "Orders", href: "/client/orders", icon: ShoppingCart },
  { key: "support", label: "Support tickets", href: "/client/support", icon: HelpCircle },
  { key: "documents", label: "Documents", href: "/client/documents", icon: FileText },
  { key: "bookings", label: "Bookings", href: "/client/bookings", icon: CalendarDays },
  { key: "catalog", label: "Catalog items", href: "/client/catalog", icon: PackageSearch },
  { key: "messages", label: "Messages", href: "/client/messages", icon: MessageSquare },
];

function customerName(profile: ClientMe) {
  return profile.organization_name || profile.contact_name || profile.email;
}

export default function ClientPortalHomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const overviewQuery = useClientOverview();
  const overview = overviewQuery.data;
  const profile = overview?.account;

  function handleSignOut() {
    clearClientToken();
    queryClient.removeQueries({ queryKey: ["client-auth"] });
    queryClient.removeQueries({ queryKey: ["client-overview"] });
    router.replace("/client/login?redirect=%2Fclient");
  }

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">
            Lynk
          </Link>
          {profile ? (
            <Button type="button" variant="outline" size="sm" onClick={handleSignOut}>
              <LogOut className="h-4 w-4" />
              Sign Out
            </Button>
          ) : (
            <Button asChild variant="outline" size="sm">
              <Link href="/client/login?redirect=%2Fclient">Client Sign In</Link>
            </Button>
          )}
        </header>

        {overviewQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-copy-muted">Loading portal...</div>
        ) : overviewQuery.error ? (
          <section className="flex flex-1 items-center justify-center py-16">
            <div className="w-full max-w-md rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <h1 className="text-xl font-semibold text-copy-primary">Client portal</h1>
              <p className="mt-2 text-p-sm text-copy-secondary">Sign in with your client account to continue.</p>
              <Button asChild className="mt-5 w-full">
                <Link href="/client/login?redirect=%2Fclient">Sign In</Link>
              </Button>
            </div>
          </section>
        ) : profile ? (
          <div className="flex-1 py-8">
            <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-card)] border border-line-strong bg-app">
                    {profile.organization_id ? <Building2 className="h-5 w-5 text-copy-secondary" /> : <BriefcaseBusiness className="h-5 w-5 text-copy-secondary" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-medium text-copy-label">Signed in as</div>
                    <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal text-copy-primary">{customerName(profile)}</h1>
                    <p className="mt-1 text-sm text-copy-secondary">{profile.email}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
                <div className="text-xs font-medium text-copy-label">Pricing group</div>
                <div className="mt-2 text-lg font-semibold text-copy-primary">{profile.customer_group?.name ?? "Standard"}</div>
                <p className="mt-1 text-sm text-copy-secondary">{profile.customer_group?.description ?? "Pricing is resolved from your account context."}</p>
              </div>
            </section>

            <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sections.map((section) => {
                const Icon = section.icon;
                const metric = overview?.metrics.find((item) => item.key === section.key);
                return (
                  <Link key={section.key} href={section.href} className="group rounded-[var(--radius-card)] border border-line-default bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-[var(--radius-card)] border border-line-strong bg-app">
                        <Icon className="h-4 w-4 text-copy-secondary" />
                      </span>
                      <ArrowRight className="h-4 w-4 text-copy-muted transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <div className="mt-4 text-2xl font-semibold text-copy-primary">{metric?.value ?? 0}</div>
                    <div className="mt-1 text-sm text-copy-secondary">{section.label}</div>
                  </Link>
                );
              })}
            </section>

            <section className="rounded-[var(--radius-card)] border border-line-default bg-surface p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-copy-primary">Next actions</h2>
                  <p className="mt-1 text-sm text-copy-muted">Current work tied to your account.</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/client/support">Need help?</Link>
                </Button>
              </div>
              <div className="grid gap-3">
                {(overview?.next_actions ?? []).map((action) => (
                  <Link key={action.key} href={action.href} className="group rounded-[var(--radius-card)] border border-line-default bg-app/60 p-4 transition-colors hover:border-line-strong">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium text-copy-primary">{action.label}</div>
                        {action.description ? <div className="mt-1 text-sm text-copy-muted">{action.description}</div> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-copy-muted">
                        {action.status ? <span className="capitalize">{action.status.replace(/_/g, " ")}</span> : null}
                        {action.created_at ? <span>{formatDateTime(action.created_at)}</span> : null}
                        <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
