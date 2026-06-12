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
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-4 py-6">
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">
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
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">Loading portal...</div>
        ) : overviewQuery.error ? (
          <section className="flex flex-1 items-center justify-center py-16">
            <div className="w-full max-w-md rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <h1 className="text-xl font-semibold text-neutral-50">Client portal</h1>
              <p className="mt-2 text-sm leading-6 text-neutral-400">Sign in with your client account to continue.</p>
              <Button asChild className="mt-5 w-full">
                <Link href="/client/login?redirect=%2Fclient">Sign In</Link>
              </Button>
            </div>
          </section>
        ) : profile ? (
          <div className="flex-1 py-8">
            <section className="mb-6 grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-md border border-neutral-700 bg-neutral-950">
                    {profile.organization_id ? <Building2 className="h-5 w-5 text-neutral-300" /> : <BriefcaseBusiness className="h-5 w-5 text-neutral-300" />}
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs uppercase tracking-wide text-neutral-500">Signed in as</div>
                    <h1 className="mt-1 truncate text-2xl font-semibold tracking-normal text-neutral-50">{customerName(profile)}</h1>
                    <p className="mt-1 text-sm text-neutral-400">{profile.email}</p>
                  </div>
                </div>
              </div>
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
                <div className="text-xs uppercase tracking-wide text-neutral-500">Pricing group</div>
                <div className="mt-2 text-lg font-semibold text-neutral-50">{profile.customer_group?.name ?? "Standard"}</div>
                <p className="mt-1 text-sm text-neutral-400">{profile.customer_group?.description ?? "Pricing is resolved from your account context."}</p>
              </div>
            </section>

            <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {sections.map((section) => {
                const Icon = section.icon;
                const metric = overview?.metrics.find((item) => item.key === section.key);
                return (
                  <Link key={section.key} href={section.href} className="group rounded-md border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
                    <div className="flex items-start justify-between gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-950">
                        <Icon className="h-4 w-4 text-neutral-300" />
                      </span>
                      <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
                    </div>
                    <div className="mt-4 text-2xl font-semibold text-neutral-50">{metric?.value ?? 0}</div>
                    <div className="mt-1 text-sm text-neutral-400">{section.label}</div>
                  </Link>
                );
              })}
            </section>

            <section className="rounded-md border border-neutral-800 bg-neutral-900 p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold text-neutral-100">Next actions</h2>
                  <p className="mt-1 text-sm text-neutral-500">Current work tied to your account.</p>
                </div>
                <Button asChild variant="outline" size="sm">
                  <Link href="/client/support">Need help?</Link>
                </Button>
              </div>
              <div className="grid gap-3">
                {(overview?.next_actions ?? []).map((action) => (
                  <Link key={action.key} href={action.href} className="group rounded-md border border-neutral-800 bg-neutral-950/60 p-4 transition-colors hover:border-neutral-600">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-100">{action.label}</div>
                        {action.description ? <div className="mt-1 text-sm text-neutral-500">{action.description}</div> : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-3 text-xs text-neutral-500">
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
