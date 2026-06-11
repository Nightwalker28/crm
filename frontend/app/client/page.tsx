"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowRight, BriefcaseBusiness, Building2, CalendarDays, FileText, HelpCircle, Home, LogOut, MessageSquare, PackageSearch, ScrollText, ShoppingCart, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { clearClientToken, useClientMe, type ClientMe } from "@/hooks/useClientPortal";

const sections = [
  { key: "home", label: "Overview", href: "/client", icon: Home, state: "Ready" },
  { key: "catalog", label: "Products and services", href: "/client/catalog", icon: PackageSearch, state: "Next" },
  { key: "orders", label: "Orders", href: "/client/orders", icon: ShoppingCart, state: "Next" },
  { key: "support", label: "Support tickets", href: "/client/support", icon: HelpCircle, state: "Next" },
  { key: "messages", label: "Messages", href: "/client/messages", icon: MessageSquare, state: "Next" },
  { key: "documents", label: "Documents", href: "/client/documents", icon: FileText, state: "Next" },
  { key: "quotes", label: "Quotes", href: "/client/quotes", icon: ScrollText, state: "Next" },
  { key: "bookings", label: "Bookings", href: "/client/bookings", icon: CalendarDays, state: "Next" },
  { key: "profile", label: "Profile", href: "/client/profile", icon: UserRound, state: "Next" },
];

function customerName(profile: ClientMe) {
  return profile.organization_name || profile.contact_name || profile.email;
}

export default function ClientPortalHomePage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const profileQuery = useClientMe();
  const profile = profileQuery.data;

  function handleSignOut() {
    clearClientToken();
    queryClient.removeQueries({ queryKey: ["client-auth"] });
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

        {profileQuery.isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">Loading portal...</div>
        ) : profileQuery.error ? (
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

            <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {sections.map((section) => {
                const Icon = section.icon;
                const enabled = section.href === "/client" || section.href === "/client/catalog" || section.href === "/client/orders" || section.href === "/client/support" || section.href === "/client/messages" || section.href === "/client/documents" || section.href === "/client/quotes" || section.href === "/client/bookings";
                const className =
                  "group rounded-md border border-neutral-800 bg-neutral-900 p-4 transition-colors " +
                  (enabled ? "hover:border-neutral-600 hover:bg-neutral-800/70" : "cursor-default opacity-70");
                const content = (
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 items-center justify-center rounded-md border border-neutral-700 bg-neutral-950">
                        <Icon className="h-4 w-4 text-neutral-300" />
                      </span>
                      <span className="font-medium text-neutral-100">{section.label}</span>
                    </div>
                    {enabled ? <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" /> : <span className="text-xs text-neutral-500">{section.state}</span>}
                  </div>
                );
                return enabled ? (
                  <Link key={section.key} href={section.href} className={className}>
                    {content}
                  </Link>
                ) : (
                  <div key={section.key} className={className}>
                    {content}
                  </div>
                );
              })}
            </section>
          </div>
        ) : null}
      </div>
    </main>
  );
}
