"use client";

import { useRouter } from "next/navigation";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { CommandIcon, CornerDownLeft, Search } from "lucide-react";

import { Dialog, DialogBackdrop, DialogPanel } from "@/components/ui/dialog";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import { SETTINGS_ROUTES } from "@/lib/routes";

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

async function fetchGlobalSearch(query: string): Promise<SearchResponse> {
  const trimmedQuery = query.trim();
  const params = new URLSearchParams({
    query: trimmedQuery,
    limit_per_module: "5",
  });
  const res = await apiFetch(`/global-search?${params.toString()}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error((body && typeof body.detail === "string" && body.detail) || "Failed to search records.");
  }
  return body as SearchResponse;
}

function canonicalizeSearchHref(href: string) {
  if (href === "/dashboard/admin" || href === "/dashboard/settings/company") return SETTINGS_ROUTES.general;
  if (href === "/dashboard/admin/users") return SETTINGS_ROUTES.users;
  if (href === "/dashboard/admin/teams") return SETTINGS_ROUTES.teams;
  if (href === "/dashboard/admin/roles-permissions" || href === "/dashboard/settings/roles-permissions") return SETTINGS_ROUTES.permissions;
  if (href === "/dashboard/admin/modules") return SETTINGS_ROUTES.modules;
  if (href === "/dashboard/admin/custom-fields" || href === "/dashboard/settings/custom-fields") return SETTINGS_ROUTES.fields;
  if (href === "/dashboard/admin/integrations") return SETTINGS_ROUTES.integrations;
  if (href === "/dashboard/admin/message-templates") return SETTINGS_ROUTES.templates;
  if (href === "/dashboard/recycle-bin") return SETTINGS_ROUTES.recycleBin;
  if (href === "/dashboard/activity-log") return SETTINGS_ROUTES.activityLog;
  return href;
}

export default function GlobalCommandPalette() {
  const router = useRouter();
  const { modules } = useAccessibleModules();
  const inputRef = useRef<HTMLInputElement | null>(null);
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
      return;
    }
    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 80);
    return () => window.clearTimeout(focusTimer);
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
          label: getModuleDisplayName(module.name, module.description ?? undefined),
          subtitle: module.base_route ?? "",
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
      const label = getModuleDisplayName(item.module_key) || item.module_label;
      const current = groups.get(label) ?? [];
      current.push({ ...item, href: canonicalizeSearchHref(item.href) });
      groups.set(label, current);
    }
    return Array.from(groups.entries());
  }, [searchQuery.data?.results]);

  function handleNavigate(href: string) {
    setQuery("");
    setOpen(false);
    router.push(canonicalizeSearchHref(href));
  }

  const canSearch = deferredQuery.length >= 2;
  const isWaitingForDeferredQuery = query.trim() !== deferredQuery;
  const isSearchPending = canSearch && (isWaitingForDeferredQuery || searchQuery.isLoading || searchQuery.isFetching);
  const hasCompletedEmptySearch = canSearch && searchQuery.isFetched && !searchQuery.isFetching && groupedResults.length === 0;

  function handleClose() {
    setQuery("");
    setOpen(false);
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
              <div className="text-xs text-neutral-500">Jump across tasks, contacts, organizations, and opportunities.</div>
            </div>
        </div>
        <div className="hidden items-center gap-1 rounded-md border border-white/10 bg-black/30 px-2 py-1 text-[11px] text-neutral-400 sm:flex">
          <CommandIcon className="h-3 w-3" />
          <span>K</span>
        </div>
      </button>

      <Dialog open={open} onClose={handleClose} className="z-50">
        <DialogBackdrop />
        <div className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]">
          <DialogPanel className="w-full max-w-2xl overflow-hidden rounded-2xl border border-white/10 bg-[#090909] p-0 shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
            <Command shouldFilter={false} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-white/8 px-4 py-3">
                <Search className="h-4 w-4 text-neutral-500" />
                <Command.Input
                  ref={inputRef}
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

              <Command.List className="scrollbar-hide max-h-[60vh] overflow-y-auto p-3">
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
                    Type at least 2 characters to search tasks, calendar events, contacts, accounts, deals, and other workspace records.
                  </div>
                ) : isSearchPending ? (
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
                ) : hasCompletedEmptySearch ? (
                  <Command.Empty className="px-3 py-8 text-center text-sm text-neutral-500">
                    No matching records found.
                  </Command.Empty>
                ) : (
                  <div className="px-3 py-8 text-center text-sm text-neutral-500">Searching…</div>
                )}
              </Command.List>
            </Command>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
