"use client";

import { usePathname, useRouter } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { Command } from "cmdk";
import { CommandIcon, CornerDownLeft, Search } from "lucide-react";

import { Dialog, DialogBackdrop, DialogPanel } from "@/components/ui/dialog";
import { useAccessibleModules, type AccessibleModuleActions } from "@/hooks/useAccessibleModules";
import { useSidebarUser } from "@/hooks/useSidebarUser";
import { apiFetch } from "@/lib/api";
import { getModuleDisplayName } from "@/lib/module-display";
import { getDependentModuleDefinitions, getModuleDefinition, getModuleRegistryLabel, getModuleRoute, isModuleVisibleInNavigation, SETTINGS_NAV_ITEMS } from "@/lib/module-registry";
import { describeRecentDashboardPage, getRecentPagesSnapshot, parseRecentPages, recordRecentPage, subscribeToRecentPages } from "@/lib/recent-pages";
import { canonicalizeDashboardHref } from "@/lib/routes";

type PaletteLink = {
  label: string;
  subtitle: string;
  href: string;
  group: string;
};

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

function canUseQuickAction(
  actions: AccessibleModuleActions | undefined,
  requiredAction: "create" | "edit" | "configure" | "export" = "create",
) {
  if (!actions) return false;
  if (requiredAction === "edit") return actions.can_edit;
  if (requiredAction === "configure") return actions.can_configure;
  if (requiredAction === "export") return actions.can_export;
  return actions.can_create;
}

export default function GlobalCommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const { modules, isLoading: modulesLoading } = useAccessibleModules();
  const { isAdmin, isLoading: userLoading, user } = useSidebarUser();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const deferredQuery = useDeferredValue(query.trim());
  const getRecentSnapshot = useCallback(() => getRecentPagesSnapshot(user?.id), [user?.id]);
  const recentPagesSnapshot = useSyncExternalStore(
    subscribeToRecentPages,
    getRecentSnapshot,
    () => "[]",
  );
  const recentPages = useMemo(
    () => parseRecentPages(recentPagesSnapshot).filter((item) => item.href !== pathname),
    [pathname, recentPagesSnapshot],
  );

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

  useEffect(() => {
    if (!user?.id || userLoading || modulesLoading) return;
    const recentPage = describeRecentDashboardPage(pathname, modules, isAdmin);
    if (recentPage) recordRecentPage(user.id, recentPage);
  }, [isAdmin, modules, modulesLoading, pathname, user?.id, userLoading]);

  const searchQuery = useQuery({
    queryKey: ["global-search", deferredQuery],
    queryFn: () => fetchGlobalSearch(deferredQuery),
    enabled: open && deferredQuery.length >= 2,
    staleTime: 15_000,
  });

  const quickLinks = useMemo(() => {
    const items = [
      { label: "Dashboard", subtitle: "Go to the home dashboard", href: "/dashboard", group: "Quick Links" },
      ...modules.flatMap((module) => {
        if (module.name.startsWith("custom_")) {
          if (!module.actions?.can_create) return [];
          const label = getModuleDisplayName(module.name, module.description ?? undefined);
          const route = getModuleRoute(module.name, module.base_route);
          return route ? [{
            label: `Create ${label}`,
            subtitle: `Add a record to ${label}`,
            href: `${route}?action=create`,
            group: "Actions",
          }] : [];
        }
        const definition = getModuleDefinition(module.name);
        if (definition?.adminOnly && !isAdmin) return [];
        const action = definition?.quickAction;
        const ownActions = action && canUseQuickAction(module.actions, action.requiredAction) ? [{
          label: action.label,
          subtitle: action.description,
          href: action.href,
          group: "Actions",
        }] : [];
        const dependentActions = getDependentModuleDefinitions(module.name).flatMap((dependent) => {
          if (dependent.adminOnly && !isAdmin) return [];
          const dependentAction = dependent.quickAction;
          if (!dependentAction || !canUseQuickAction(module.actions, dependentAction.requiredAction)) return [];
          return [{
            label: dependentAction.label,
            subtitle: dependentAction.description,
            href: dependentAction.href,
            group: "Actions",
          }];
        });
        return [...ownActions, ...dependentActions];
      }),
      ...modules
        .filter((module) => module.base_route)
        .filter((module) => module.name.startsWith("custom_") || isModuleVisibleInNavigation(module.name) || (isAdmin && getModuleDefinition(module.name)?.adminOnly))
        .map((module) => ({
          label: getModuleDisplayName(module.name, module.description ?? undefined),
          subtitle: getModuleRoute(module.name, module.base_route),
          href: getModuleRoute(module.name, module.base_route),
          group: "Modules",
        })),
      ...modules.flatMap((module) => getDependentModuleDefinitions(module.name)
        .filter((dependent) => !dependent.adminOnly || isAdmin)
        .map((dependent) => ({
          label: dependent.label,
          subtitle: dependent.route,
          href: dependent.route,
          group: "Modules",
        }))),
      ...(isAdmin ? SETTINGS_NAV_ITEMS.map((item) => ({
        label: item.label,
        subtitle: item.href,
        href: item.href,
        group: "Settings",
      })) : []),
    ];

    const deduped = new Map<string, PaletteLink>();
    for (const item of items) {
      deduped.set(item.href, item);
    }
    return Array.from(deduped.values());
  }, [isAdmin, modules]);

  const matchingQuickLinks = useMemo(() => {
    const normalized = deferredQuery.toLowerCase();
    if (!normalized) return quickLinks;
    return quickLinks.filter((item) => `${item.label} ${item.subtitle}`.toLowerCase().includes(normalized));
  }, [deferredQuery, quickLinks]);

  const groupedResults = useMemo(() => {
    const groups = new Map<string, SearchResult[]>();
    for (const item of searchQuery.data?.results ?? []) {
      const label = getModuleRegistryLabel(item.module_key) ?? item.module_label;
      const current = groups.get(label) ?? [];
      current.push({ ...item, href: canonicalizeDashboardHref(item.href) });
      groups.set(label, current);
    }
    return Array.from(groups.entries());
  }, [searchQuery.data?.results]);

  function handleNavigate(href: string) {
    const canonicalHref = canonicalizeDashboardHref(href);
    setQuery("");
    setOpen(false);
    router.push(canonicalHref);
  }

  const canSearch = deferredQuery.length >= 2;
  const isWaitingForDeferredQuery = query.trim() !== deferredQuery;
  const isSearchPending = canSearch && (isWaitingForDeferredQuery || searchQuery.isLoading || searchQuery.isFetching);
  const hasCompletedEmptySearch = canSearch && searchQuery.isFetched && !searchQuery.isFetching && groupedResults.length === 0 && matchingQuickLinks.length === 0;

  function handleClose() {
    setQuery("");
    setOpen(false);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-line-default bg-surface-muted px-3 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-raised focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        aria-label="Open command palette"
      >
        <div className="flex items-center gap-3">
          <Search className="h-4 w-4 text-copy-muted" />
            <div>
              <div className="text-sm font-medium text-copy-primary">Search records</div>
              <div className="text-xs text-copy-muted">Jump across modules and workspace records.</div>
            </div>
        </div>
        <div className="hidden items-center gap-1 rounded-[var(--radius-control-sm)] border border-line-default bg-app px-2 py-1 text-[11px] text-copy-muted sm:flex">
          <CommandIcon className="h-3 w-3" />
          <span>K</span>
        </div>
      </button>

      <Dialog open={open} onClose={handleClose} className="z-50">
        <DialogBackdrop />
        <div className="fixed inset-0 flex items-start justify-center px-4 pt-[12vh]">
          <DialogPanel className="w-full max-w-2xl overflow-hidden rounded-[var(--radius-dialog)] border border-line-default bg-surface-raised p-0 shadow-[0_32px_100px_rgba(0,0,0,0.55)]">
            <Command shouldFilter={false} className="overflow-hidden bg-transparent">
              <div className="flex items-center gap-3 border-b border-line-subtle px-4 py-3">
                <Search className="h-4 w-4 text-copy-muted" />
                <Command.Input
                  ref={inputRef}
                  value={query}
                  onValueChange={setQuery}
                  placeholder="Search records across the workspace..."
                  className="h-10 w-full bg-transparent text-sm text-copy-primary outline-none placeholder:text-copy-muted"
                  aria-label="Search records and modules"
                />
                <div className="hidden items-center gap-1 text-[11px] text-copy-muted sm:flex">
                  <CornerDownLeft className="h-3 w-3" />
                  <span>Open</span>
                </div>
              </div>

              <Command.List className="scrollbar-hide max-h-[60vh] overflow-y-auto p-3">
                {!deferredQuery.length ? (
                  <>
                    {recentPages.length ? (
                      <Command.Group className="mb-3" data-testid="recent-pages">
                        <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
                          Recent Pages
                        </div>
                        {recentPages.map((item) => (
                          <Command.Item
                            key={`recent-${item.href}`}
                            value={`recent-${item.href}`}
                            onSelect={() => handleNavigate(item.href)}
                            className="flex cursor-pointer items-center justify-between rounded-[var(--radius-control)] px-3 py-3 text-sm text-copy-secondary outline-none data-[selected=true]:bg-action-primary-muted data-[selected=true]:text-copy-primary"
                          >
                            <div>
                              <div className="font-medium text-copy-primary">{item.label}</div>
                              <div className="mt-1 text-xs text-copy-muted">{item.subtitle}</div>
                            </div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-copy-muted">Recent</div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    ) : null}
                    <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
                      Quick Links
                    </div>
                    {quickLinks.map((item) => (
                      <Command.Item
                        key={item.href}
                        value={item.href}
                        onSelect={() => handleNavigate(item.href)}
                        className="flex cursor-pointer items-center justify-between rounded-[var(--radius-control)] px-3 py-3 text-sm text-copy-secondary outline-none data-[selected=true]:bg-action-primary-muted data-[selected=true]:text-copy-primary"
                      >
                        <div>
                          <div className="font-medium text-copy-primary">{item.label}</div>
                          <div className="mt-1 text-xs text-copy-muted">{item.subtitle}</div>
                        </div>
                        <div className="text-[11px] uppercase tracking-[0.14em] text-copy-muted">{item.group}</div>
                      </Command.Item>
                    ))}
                  </>
                ) : (
                  <>
                    {matchingQuickLinks.length ? (
                      <Command.Group className="mb-3 overflow-hidden rounded-[var(--radius-card)] border border-line-subtle bg-surface p-1 text-copy-secondary">
                        <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
                          Modules
                        </div>
                        {matchingQuickLinks.map((item) => (
                          <Command.Item
                            key={`module-${item.href}`}
                            value={`module-${item.label}-${item.href}`}
                            onSelect={() => handleNavigate(item.href)}
                            className="flex cursor-pointer items-center justify-between rounded-[var(--radius-control)] px-3 py-3 text-sm text-copy-secondary outline-none data-[selected=true]:bg-action-primary-muted data-[selected=true]:text-copy-primary"
                          >
                            <div>
                              <div className="font-medium text-copy-primary">{item.label}</div>
                              <div className="mt-1 text-xs text-copy-muted">{item.subtitle}</div>
                            </div>
                            <div className="text-[11px] uppercase tracking-[0.14em] text-copy-muted">{item.group}</div>
                          </Command.Item>
                        ))}
                      </Command.Group>
                    ) : null}
                    {deferredQuery.length < 2 ? (
                      <div className="px-3 py-8 text-center text-sm text-copy-muted">
                        Type at least 2 characters to search workspace records.
                      </div>
                    ) : isSearchPending ? (
                      <div className="px-3 py-8 text-center text-sm text-copy-muted">Searching records…</div>
                    ) : searchQuery.error ? (
                      <div className="rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
                        {searchQuery.error instanceof Error ? searchQuery.error.message : "Failed to search records."}
                      </div>
                    ) : groupedResults.length ? (
                      groupedResults.map(([group, items]) => (
                        <Command.Group
                          key={group}
                          heading={group}
                          className="mb-3 overflow-hidden rounded-[var(--radius-card)] border border-line-subtle bg-surface p-1 text-copy-secondary"
                        >
                          <div className="px-2 pb-2 pt-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-copy-muted">
                            {group}
                          </div>
                          {items.map((item) => (
                            <Command.Item
                              key={`${item.module_key}-${item.record_id}`}
                              value={`${item.module_key}-${item.record_id}-${item.title}`}
                              onSelect={() => handleNavigate(item.href)}
                              className="cursor-pointer rounded-[var(--radius-control)] px-3 py-3 outline-none data-[selected=true]:bg-action-primary-muted"
                            >
                              <div className="text-sm font-medium text-copy-primary">{item.title}</div>
                              {item.subtitle ? <div className="mt-1 text-xs text-copy-muted">{item.subtitle}</div> : null}
                            </Command.Item>
                          ))}
                        </Command.Group>
                      ))
                    ) : hasCompletedEmptySearch ? (
                      <Command.Empty className="px-3 py-8 text-center text-sm text-copy-muted">
                        No matching modules or records found.
                      </Command.Empty>
                    ) : null}
                  </>
                )}
              </Command.List>
            </Command>
          </DialogPanel>
        </div>
      </Dialog>
    </>
  );
}
