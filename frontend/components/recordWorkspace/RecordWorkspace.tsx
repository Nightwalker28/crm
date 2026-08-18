"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Tabs } from "radix-ui";

import { PageShell } from "@/components/ui/PageShell";
import { cn } from "@/lib/utils";

/**
 * Archetype 2 — the record page, and the only shape a record detail page takes.
 *
 * The census called the old `RecordWorkspace` "nearly a no-op forwarding to `PageShell`",
 * and it was: the seven archetypes it was supposed to unify all lived in the page files.
 * This one owns the geometry instead — the header row, the spine, the content region, and
 * critically **the only tab strip on the page**.
 *
 * That last part is why the tabs are named props rather than an array. `Details ·
 * Timeline · Tasks · Files` is fixed by §4.7, and a `tabs={[…]}` API would let the next
 * page reorder them, rename one, or — as `opportunities/[opportunityId]` and
 * `finance/pos/[invoiceId]` both did — nest a second strip inside the first. Named slots
 * make all three unrepresentable. A module's own tab appends after `Files` through
 * `extraTabs`, which is the one thing §4.7 permits.
 *
 * A tab whose slot is omitted is not rendered, so permission gating is "pass nothing".
 */

export type RecordExtraTab = {
  id: string;
  label: string;
  content: ReactNode;
};

type RecordWorkspaceProps = {
  /** The record's name. Also `PageShell`'s `title`, so it is the page's one h1 (§8). */
  title: string;
  description?: string;
  backHref: string;
  backLabel: string;

  /** Beside the title — a status, an SLA marker. One instance, so it may take tone (R5). */
  status?: ReactNode;
  /** Under the title — the identifying line a list row would show. */
  subtitle?: ReactNode;
  /** The header's action group. `Edit` belongs here, reachable from every tab (R2). */
  actions?: ReactNode;

  /** `RecordSpine` and its blocks. The page's only editable region (R9). */
  spine: ReactNode;

  details: ReactNode;
  timeline?: ReactNode;
  tasks?: ReactNode;
  files?: ReactNode;
  /** Module-specific tabs, appended after `Files` — the only extension §4.7 allows. */
  extraTabs?: RecordExtraTab[];

  /** Replaces the whole page. Forwarded to `PageShell`, which owns the §7.4 states. */
  isPermissionDenied?: boolean;
  isLoading?: boolean;
  hasError?: boolean;
  errorState?: ReactNode;
  loadingState?: ReactNode;
  onRetry?: () => void;
};

const TAB_PARAM = "tab";

export function RecordWorkspace({
  title,
  description,
  backHref,
  backLabel,
  status,
  subtitle,
  actions,
  spine,
  details,
  timeline,
  tasks,
  files,
  extraTabs = [],
  isPermissionDenied,
  isLoading,
  hasError,
  errorState,
  loadingState,
  onRetry,
}: RecordWorkspaceProps) {
  const tabs: RecordExtraTab[] = [
    { id: "details", label: "Details", content: details },
    ...(timeline ? [{ id: "timeline", label: "Timeline", content: timeline }] : []),
    ...(tasks ? [{ id: "tasks", label: "Tasks", content: tasks }] : []),
    ...(files ? [{ id: "files", label: "Files", content: files }] : []),
    ...extraTabs,
  ];

  const state = isPermissionDenied || isLoading || hasError;

  return (
    <PageShell
      variant="record"
      title={title}
      description={description}
      isPermissionDenied={isPermissionDenied}
      isLoading={isLoading}
      hasError={hasError}
      errorState={errorState}
      loadingState={loadingState}
      onRetry={onRetry}
      backHref={backHref}
      backLabel={backLabel}
    >
      <RecordWorkspaceHeader
        title={title}
        backHref={backHref}
        backLabel={backLabel}
        status={status}
        subtitle={subtitle}
        actions={actions}
      />
      {/* Below `lg` this is a plain stack and the page scrolls as a document; from `lg` it
          is the two-column split where only the content region scrolls (R9). */}
      <div className="flex min-w-0 flex-col gap-6 lg:min-h-0 lg:flex-1 lg:flex-row lg:gap-8">
        {spine}
        {state ? null : <RecordContent tabs={tabs} />}
      </div>
    </PageShell>
  );
}

/**
 * The header row: back link, name, status, actions.
 *
 * The name is drawn here rather than by `PageHeader`, whose h1 is deliberately `sr-only`
 * (§8) — the operator came for *Jane Doe*, so the record's name is the one thing on the
 * page allowed to be larger than the body (R7).
 */
function RecordWorkspaceHeader({
  title,
  backHref,
  backLabel,
  status,
  subtitle,
  actions,
}: {
  title: string;
  backHref: string;
  backLabel: string;
  status?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div data-slot="record-header" className="flex min-w-0 flex-col gap-3">
      <Link
        href={backHref}
        className={cn(
          "-mx-2 flex w-fit items-center gap-1.5 rounded-[var(--radius-control)] px-2 py-1",
          "text-xs font-medium text-copy-muted transition-colors hover:text-copy-primary",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
        )}
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
        {backLabel}
      </Link>
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <h2
              className="truncate text-lg font-semibold text-copy-primary"
              data-record-workspace-title
            >
              {title}
            </h2>
            {status}
          </div>
          {subtitle ? (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-copy-muted">
              {subtitle}
            </div>
          ) : null}
        </div>
        {actions ? (
          <div
            data-record-workspace-actions
            className="flex min-w-0 flex-wrap items-center gap-2"
          >
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The content region — the page's only scroller.
 *
 * The strip is pinned as a flex sibling of the panel, the same mechanism archetype 1 uses
 * for its toolbar (§11.1): nothing is `position: sticky`, nothing overlaps, and a long
 * Details tab cannot scroll its own tabs out of reach.
 *
 * Built on Radix rather than `RecordTabs` because the URL contract is different — the
 * archetype's strip *must* survive the `/[id]/edit` round trip (R2), which means the tab
 * lives in `?tab=` unconditionally rather than only when a caller opts in.
 */
function RecordContent({ tabs }: { tabs: RecordExtraTab[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const fallbackTabId = tabs[0]?.id;
  const requested = searchParams.get(TAB_PARAM);
  const activeTabId = tabs.some((tab) => tab.id === requested)
    ? (requested as string)
    : fallbackTabId;

  function selectTab(tabId: string) {
    const nextParams = new URLSearchParams(searchParams.toString());
    if (tabId === fallbackTabId) nextParams.delete(TAB_PARAM);
    else nextParams.set(TAB_PARAM, tabId);
    const query = nextParams.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  if (!activeTabId) return null;

  return (
    <Tabs.Root
      value={activeTabId}
      onValueChange={selectTab}
      data-slot="record-content"
      className="flex min-w-0 flex-col gap-5 lg:min-h-0 lg:flex-1"
    >
      <div className="shrink-0 overflow-x-auto border-b border-line-default">
        <Tabs.List className="flex min-w-max gap-2">
          {tabs.map((tab) => (
            <Tabs.Trigger
              key={tab.id}
              value={tab.id}
              className={cn(
                "border-b-2 border-transparent px-3 py-2 text-sm font-medium text-copy-muted transition-colors",
                "hover:text-copy-primary",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
                "data-[state=active]:border-primary data-[state=active]:text-copy-primary",
              )}
            >
              {tab.label}
            </Tabs.Trigger>
          ))}
        </Tabs.List>
      </div>

      {tabs.map((tab) => (
        <Tabs.Content
          key={tab.id}
          value={tab.id}
          // `lg:min-h-0` is load-bearing here for the same reason it is on the list page:
          // without it the flex child refuses to shrink and the whole page scrolls again.
          className="focus-visible:outline-none lg:min-h-0 lg:flex-1 lg:overflow-y-auto"
        >
          {tab.content}
        </Tabs.Content>
      ))}
    </Tabs.Root>
  );
}

/**
 * Builds an `/[id]/edit` href that carries the current tab, and the `?from=` that sends the
 * operator back to it.
 *
 * R2 names this as most of why the edit round trip feels expensive: today `/[id]/edit`
 * drops `?tab=`, so editing from the Files tab lands you back on Details. Preserving it in
 * both directions is a two-line contract, and it is here so no page has to remember it.
 */
export function recordEditHref(editHref: string, tab?: string | null) {
  if (!tab) return editHref;
  const separator = editHref.includes("?") ? "&" : "?";
  return `${editHref}${separator}${TAB_PARAM}=${encodeURIComponent(tab)}`;
}

/** The record href to return to after an edit, restoring the tab the operator left from. */
export function recordReturnHref(recordHref: string, tab?: string | null) {
  return recordEditHref(recordHref, tab);
}

export { TAB_PARAM as RECORD_TAB_PARAM };
