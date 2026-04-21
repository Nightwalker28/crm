"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { CommandIcon, CornerDownLeft, Search } from "lucide-react";

import { Dialog, DialogBackdrop, DialogPanel } from "@/components/ui/dialog";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { apiFetch } from "@/lib/api";

type SearchResult = {
  module_key: string;
  module_label: string;
  record_id: string;
  title: string;
  subtitle?: string | null;
  href: string;
};

type SearchResponse = {
  query: string;
  results: SearchResult[];
};

const MODULE_LABELS: Record<string, string> = {
  sales_organizations: "Organizations",
  sales_contacts: "Contacts",
  sales_opportunities: "Opportunities",
  finance_io: "Insertion Orders",
};

async function fetchGlobalSearch(query: string): Promise<SearchResponse> {
  const params = new URLSearchParams({
    query,
    limit_per_module: "5",
  });
  const res = await apiFetch(`/global-search?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to search records.");
  }
  return body as SearchResponse;
}

export default function GlobalCommandPalette() {
  const router = useRouter();
  const { modules } = useAccessibleModules();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) {
      setQuery("");
    }
  }, [open]);

  const searchQuery = useQuery({
    queryKey: ["global-search", deferredQuery],
    queryFn: () => fetchGlobalSearch(deferredQuery),
    enabled: open && deferredQuery.length >= 2,
    staleTime: 15_000,
  });

  const quickLinks = useMemo(() => {
    const items = [
      { label: "Dashboard", subtitle: "Go to the home dashboard", href: "/dashboard", group: "Quick Links" },
      ...modules
        .filter((module) => module.base_route)
        .map((module) => ({
          label: MODULE_LABELS[module.name] ?? module.description ?? module.name,
          subtitle: module.base_route,
          href: module.base_route as string,
          group: "Modules",
        })),
    ];

    const deduped = new Map<string, { label: string; subtitle: string; href: string; group: string }>();
    for (const item of items) {
      deduped.set(item.href, item);
    }
    return Array.from(deduped.values());
  }, [modules]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const item of searchQuery.data?.results ?? []) {
      const current = groups.get(item.module_label) ?? [];
      current.push(item);
      groups.set(item.module_label, current);
    }
    return Array.from(groups.entries());
  }, [searchQuery.data?.results]);

  function handleNavigate(href: string) {
    setOpen(false);
    router.push(href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-lg border border-white/8 bg-white/[0.04] px-3 py-2 text-left transition-colors hover:border-white/12 hover:bg-white/[0.06]"
      >
        <div className="flex items-center gap-3">
          <Search className="h-4 w-4 text-neutral-500" />
          <div>
            <div className="text-sm font-medium text-neutral-100">Search records</div>
            <div className="text-xs text-neutral-500">Jump across contacts, organizations, and opportunities.</div>
          </div>
        </div>
        <div className="hidden items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-neutral-400 sm:flex">
          <CommandIcon className="h-3 w-3" />
          <span>K</span>
        </div>
      </button>

      <Dialog open={open} onClose={setOpen} className="z-50">
        <DialogBackdrop />
        <div className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]">
          <DialogPanel className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#090909] p-0 shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
            <Command shouldFilter={false} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                <Search className="h-4 w-4 text-neutral-500" />
                <Command.Input
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search records across the workspace..."
                  className="h-10 w-full bg-transparent text-sm text-neutral-100 outline-none placeholder:text-neutral-500"
                />
                <div className="hidden items-center gap-1 text-[11px] text-neutral-500 sm:flex">
                  <CornerDownLeft className="h-3 w-3" />
                  <span>Open</span>
                </div>
              </div>

              <Command.List className="max-h-[60vh] overflow-y-auto p-3">
                {!deferredQuery.length ? (
                  <>
                    <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                      Quick Links
                    </div>
                    {quickLinks.map((item) => (
                      <Command.Item
                        key={item.href}
                        value={item.href}
                        onSelect={() => handleNavigate(item.href)}
                        className="flex cursor-pointer items-center justify-between rounded-xl px-3 py-3 text-sm text-neutral-200 outline-none data-[selected=true]:bg-white/[0.06]"
                      >
                        <div>
                          <div className="font-medium text-neutral-100">{item.label}</div>
                          <div className="mt-1 text-xs text-neutral-500">{item.subtitle}</div>
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-neutral-500">{item.group}</div>
                      </Command.Item>
                    ))}
                  </>
                ) : deferredQuery.length < 2 ? (
                  <div className="px-3 py-8 text-center text-sm text-neutral-500">
                    Type at least 2 characters to search records.
                  </div>
                ) : searchQuery.isLoading ? (
                  <div className="px-3 py-8 text-center text-sm text-neutral-500">Searching…</div>
                ) : searchQuery.error ? (
                  <div className="rounded-xl border border-red-800 bg-red-950/40 px-4 py-3 text-sm text-red-200">
                    {searchQuery.error instanceof Error ? searchQuery.error.message : "Failed to search records."}
                  </div>
                ) : groupedResults.length ? (
                  groupedResults.map(([group, items]) => (
                    <Command.Group
                      key={group}
                      heading={group}
                      className="mb-3 overflow-hidden rounded-xl border border-white/6 bg-white/[0.02] p-1 text-neutral-200"
                    >
                      <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-neutral-500">
                        {group}
                      </div>
                      {items.map((item) => (
                        <Command.Item
                          key={`${item.module_key}-${item.record_id}`}
                          value={`${item.module_key}-${item.record_id}-${item.title}`}
                          onSelect={() => handleNavigate(item.href)}
                          className="cursor-pointer rounded-lg px-3 py-3 outline-none data-[selected=true]:bg-white/[0.06]"
                        >
                          <div className="text-sm font-medium text-neutral-100">{item.title}</div>
                          {item.subtitle ? <div className="mt-1 text-xs text-neutral-500">{item.subtitle}</div> : null}
                        </Command.Item>
                      ))}
                    </Command.Group>
                  ))
                ) : (
                  <Command.Empty className="px-3 py-8 text-center text-sm text-neutral-500">
                    No matching records found.
                  </Command.Empty>
                )}
              </Command.List>
            </Command>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
