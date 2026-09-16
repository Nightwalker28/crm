"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";

export const SidebarNav = ({ children }: { children: React.ReactNode }) => {
  return (
    <nav
      className="flex min-h-0 w-full flex-1 flex-col gap-1 overflow-y-scroll overflow-x-hidden pr-1 [&::-webkit-scrollbar]:hidden"
      style={{ scrollbarWidth: "none", msOverflowStyle: "none" }}
    >
      {children}
    </nav>
  );
};

export const SidebarGroup = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-x-clip">{children}</div>;
};

export const SidebarMenu = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-x-clip">{children}</div>;
};

/**
 * The one navigation item treatment, read by the sidebar and the settings rail (design.md
 * §7.16). Current is elevation and a bar in ink; it was the primary action's tint in a
 * bordered box, the state §7.13–§7.15 each took the tint off.
 */
export function navItemClassName(active: boolean) {
  return cn(
    "relative flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-control)] px-2 py-1.5 text-left text-sm font-medium",
    "transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
    active
      ? "bg-surface-raised text-copy-primary before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-copy-primary"
      : "text-copy-secondary hover:bg-surface-muted hover:text-copy-primary",
  );
}

type SidebarChildProps = {
  href?: string;
};

function getChildHref(child: React.ReactNode) {
  if (!React.isValidElement<SidebarChildProps>(child)) return undefined;
  return child.props.href;
}

function useIsActive() {
  const pathname = usePathname();
  return React.useCallback(
    (href?: string) => {
      if (!href) return false;
      if (href === "/") return pathname === "/";
      return pathname === href || pathname.startsWith(href + "/");
    },
    [pathname],
  );
}

export function SidebarMenuItemCollapsible({
  icon: Icon,
  label,
  children,
  collapsed = false,
  open,
  onOpenChange,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  collapsed?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isActiveFn = useIsActive();
  const childItems = React.Children.toArray(children);
  const hasActiveChild = childItems.some((child) => isActiveFn(getChildHref(child)));
  const [internalOpen, setInternalOpen] = React.useState(hasActiveChild);
  const isOpen = open ?? internalOpen;
  const listId = React.useId();

  React.useEffect(() => {
    if (hasActiveChild && open === undefined) {
      setInternalOpen(true);
    }
  }, [hasActiveChild, open]);

  const setOpen = onOpenChange ?? setInternalOpen;
  const childrenShown = isOpen && !collapsed;
  // §7.16: the group marks the position only while the current item under it is hidden.
  // With the item showing, the group takes ink so the branch is findable, and no more.
  const markSelf = hasActiveChild && !childrenShown;

  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-x-clip">
      <button
        type="button"
        title={collapsed ? label : undefined}
        onClick={() => setOpen(!isOpen)}
        aria-expanded={childrenShown}
        aria-controls={listId}
        className={cn(navItemClassName(markSelf), hasActiveChild && "text-copy-primary")}
      >
        {Icon && (
          <Icon className={cn("h-4 w-4 shrink-0", hasActiveChild ? "text-copy-primary" : "text-copy-muted")} />
        )}
        <span className={collapsed ? "sr-only" : "min-w-0 flex-1 truncate"}>{label}</span>
        <ChevronRight
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-copy-muted transition-transform duration-200 motion-reduce:transition-none",
            collapsed && "hidden",
            isOpen && "rotate-90",
          )}
        />
      </button>

      {/* Closed, the links were `max-h-0 opacity-0` and still in the tab order. */}
      <div
        id={listId}
        inert={!childrenShown}
        className={cn(
          "ml-4 flex min-w-0 max-w-[calc(100%-1rem)] flex-col gap-0.5 overflow-hidden border-l border-line-subtle pl-1.5 transition-[max-height,opacity] duration-200 motion-reduce:transition-none",
          childrenShown ? "max-h-96 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        {childItems}
      </div>
    </div>
  );
}

export function SidebarMenuItemChild({
  href,
  children,
  collapsed = false,
  onNavigate,
}: {
  href: string;
  children: React.ReactNode;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const isActiveFn = useIsActive();
  const active = isActiveFn(href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(navItemClassName(active), "rounded-[var(--radius-control-sm)]")}
    >
      <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{children}</span>
    </Link>
  );
}

export function SidebarMenuItemLink({
  href,
  label,
  icon: Icon,
  collapsed = false,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  collapsed?: boolean;
  onNavigate?: () => void;
}) {
  const isActiveFn = useIsActive();
  const active = isActiveFn(href);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      title={collapsed ? label : undefined}
      aria-current={active ? "page" : undefined}
      className={navItemClassName(active)}
    >
      <Icon className={cn("h-4 w-4 shrink-0", active ? "text-copy-primary" : "text-copy-muted")} />
      <span className={collapsed ? "sr-only" : "min-w-0 truncate"}>{label}</span>
    </Link>
  );
}
