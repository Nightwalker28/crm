"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

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
  return <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-x-hidden">{children}</div>;
};

export const SidebarMenu = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-x-hidden">{children}</div>;
};

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

function GlassItemWrapper({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="relative group/item">
      {children}
    </div>
  );
}

export function SidebarMenuItem({
  href,
  icon: Icon,
  children,
  collapsed = false,
}: {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  const isActiveFn = useIsActive();
  const active = isActiveFn(href);

  return (
    <GlassItemWrapper>
      <Link
        href={href}
        title={collapsed ? String(children) : undefined}
        className={
          "relative z-10 flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-control)] border px-2 py-1.5 text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
          (active
            ? "border-primary/20 bg-action-primary-muted text-primary before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-primary"
            : "border-transparent bg-transparent text-copy-secondary hover:border-line-subtle hover:bg-surface-muted hover:text-copy-primary")
        }
      >
        {Icon && (
          <Icon
            className={
              "h-4 w-4 shrink-0 transition-colors " +
              (active ? "text-primary" : "text-copy-muted")
            }
          />
        )}
        <span
          className={
            "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-sm transition-all duration-200 " +
            (collapsed ? "sr-only" : "opacity-100")
          }
        >
          {children}
        </span>
      </Link>
    </GlassItemWrapper>
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

  React.useEffect(() => {
    if (hasActiveChild && open === undefined) {
      setInternalOpen(true);
    }
  }, [hasActiveChild, open]);

  const activeSelf = hasActiveChild;
  const setOpen = onOpenChange ?? setInternalOpen;

  return (
    <div className="flex w-full min-w-0 flex-col gap-0.5 overflow-x-hidden">
      <GlassItemWrapper>
        <button
          type="button"
          title={collapsed ? label : undefined}
          onClick={() => setOpen(!isOpen)}
          aria-expanded={isOpen}
          className={
            "relative z-10 flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-control)] border px-2 py-1.5 text-left text-sm font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
            (activeSelf
              ? "border-primary/20 bg-action-primary-muted text-primary before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-primary"
              : "border-transparent bg-transparent text-copy-secondary hover:border-line-subtle hover:bg-surface-muted hover:text-copy-primary")
          }
        >
          {Icon && (
            <Icon
              className={
                "h-4 w-4 shrink-0 transition-colors " +
                (activeSelf ? "text-primary" : "text-copy-muted")
              }
            />
          )}
          <span
            className={
              "min-w-0 flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-sm transition-all duration-200 " +
              (collapsed ? "sr-only" : "opacity-100")
            }
          >
            {label}
          </span>
          <ChevronRight
            className={
              "h-3.5 w-3.5 shrink-0 transition-transform duration-200 " +
              (collapsed ? "hidden" : "") +
              " " +
              (isOpen ? "rotate-90" : "") +
              " " +
              (activeSelf ? "text-primary" : "text-copy-muted")
            }
          />
        </button>
      </GlassItemWrapper>

      <div
        className={
          "ml-4 flex min-w-0 max-w-[calc(100%-1rem)] flex-col gap-0.5 overflow-hidden border-l border-line-subtle pl-1.5 transition-all duration-200 motion-reduce:transition-none " +
          (collapsed ? "max-h-0 opacity-0" : isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0")
        }
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
}: {
  href: string;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  const isActiveFn = useIsActive();
  const active = isActiveFn(href);

  return (
    <GlassItemWrapper>
      <Link
        href={href}
        className={
          "relative z-10 flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[var(--radius-control-sm)] border px-2 py-1.5 text-[13px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary " +
          (active
            ? "border-primary/20 bg-action-primary-muted text-primary before:absolute before:bottom-1.5 before:left-0 before:top-1.5 before:w-0.5 before:rounded-full before:bg-primary"
            : "border-transparent bg-transparent text-copy-secondary hover:border-line-subtle hover:bg-surface-muted hover:text-copy-primary")
        }
      >
        <span
          className={
            "min-w-0 overflow-hidden text-ellipsis whitespace-nowrap transition-all duration-200 " +
            (collapsed ? "sr-only" : "opacity-100")
          }
        >
          {children}
        </span>
      </Link>
    </GlassItemWrapper>
  );
}
