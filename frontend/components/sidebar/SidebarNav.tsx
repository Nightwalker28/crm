"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

export const SidebarNav = ({ children }: { children: React.ReactNode }) => {
  return <nav className="flex w-full flex-col gap-1">{children}</nav>;
};

export const SidebarGroup = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex flex-col gap-0.5 w-full">{children}</div>;
};

export const SidebarMenu = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex flex-col gap-0.5 w-full">{children}</div>;
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
  active,
}: {
  children: React.ReactNode;
  active: boolean;
}) {
  return (
    <div className="relative group/item">
      <div
        className={
          "noise-overlay absolute inset-0 pointer-events-none rounded-md transition-opacity duration-150 " +
          (active ? "opacity-15" : "opacity-0 group-hover/item:opacity-10")
        }
      />
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
    <GlassItemWrapper active={active}>
      <Link
        href={href}
        title={collapsed ? String(children) : undefined}
        className={
          "relative z-10 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-150 " +
          (active
            ? "bg-white/10 text-neutral-100 border border-white/20 backdrop-blur-sm"
            : "bg-transparent text-neutral-400 border border-transparent hover:bg-white/6 hover:text-neutral-100 hover:border-white/12")
        }
      >
        {Icon && (
          <Icon
            className={
              "h-4 w-4 shrink-0 transition-colors " +
              (active ? "text-neutral-100" : "text-neutral-400")
            }
          />
        )}
        <span
          className={
            "overflow-hidden whitespace-nowrap text-sm transition-all duration-200 " +
            (collapsed
              ? "w-0 opacity-0 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100"
              : "opacity-100")
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
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
  collapsed?: boolean;
}) {
  const isActiveFn = useIsActive();
  const childItems = React.Children.toArray(children);
  const hasActiveChild = childItems.some((child) => isActiveFn(getChildHref(child)));
  const [open, setOpen] = React.useState(hasActiveChild);

  React.useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  const activeSelf = hasActiveChild;

  return (
    <div className="flex flex-col gap-0.5 w-full">
      <GlassItemWrapper active={activeSelf}>
        <button
          type="button"
          title={collapsed ? label : undefined}
          onClick={() => setOpen((v) => !v)}
          className={
            "relative z-10 flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-left transition-all duration-150 " +
            (activeSelf
              ? "bg-white/10 text-neutral-100 border border-white/20 backdrop-blur-sm"
              : "bg-transparent text-neutral-400 border border-transparent hover:bg-white/6 hover:text-neutral-100 hover:border-white/12")
          }
        >
          {Icon && (
            <Icon
              className={
                "h-4 w-4 shrink-0 transition-colors " +
                (activeSelf ? "text-neutral-100" : "text-neutral-400")
              }
            />
          )}
          <span
            className={
              "flex-1 overflow-hidden whitespace-nowrap text-sm transition-all duration-200 " +
              (collapsed
                ? "w-0 opacity-0 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100"
                : "opacity-100")
            }
          >
            {label}
          </span>
          <ChevronRight
            className={
              "h-3.5 w-3.5 shrink-0 transition-transform duration-200 " +
              (collapsed ? "opacity-0 group-hover/sidebar:opacity-100" : "") +
              " " +
              (open ? "rotate-90" : "") +
              " " +
              (activeSelf ? "text-neutral-300" : "text-neutral-500")
            }
          />
        </button>
      </GlassItemWrapper>

      {/* Child items — hidden in icon-only collapsed state, shown on hover */}
      <div
        className={
          "ml-4 flex flex-col gap-0.5 border-l border-neutral-800/70 pl-1.5 overflow-hidden transition-all duration-200 " +
          (collapsed
            ? "max-h-0 opacity-0 group-hover/sidebar:max-h-64 group-hover/sidebar:opacity-100"
            : open
              ? "max-h-64 opacity-100"
              : "max-h-0 opacity-0")
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
    <GlassItemWrapper active={active}>
      <Link
        href={href}
        className={
          "relative z-10 w-full flex items-center gap-2 rounded-md px-2 py-1 text-[13px] font-medium transition-all duration-150 " +
          (active
            ? "bg-white/10 text-neutral-100 border border-white/20 backdrop-blur-sm"
            : "bg-transparent text-neutral-400 border border-transparent hover:bg-white/6 hover:text-neutral-100 hover:border-white/12")
        }
      >
        <span
          className={
            "overflow-hidden whitespace-nowrap transition-all duration-200 " +
            (collapsed
              ? "w-0 opacity-0 group-hover/sidebar:w-auto group-hover/sidebar:opacity-100"
              : "opacity-100")
          }
        >
          {children}
        </span>
      </Link>
    </GlassItemWrapper>
  );
}
