"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";

export const SidebarNav = ({ children }: { children: React.ReactNode }) => {
  return <nav className="flex flex-col gap-4 w-full">{children}</nav>;
};

export const SidebarGroup = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex flex-col gap-1 w-full">{children}</div>;
};

export const SidebarGroupLabel = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  return (
    <div className="pb-1 px-2 text-[0.7rem] uppercase tracking-[0.18em] text-neutral-100 w-full">
      {children}
    </div>
  );
};

export const SidebarMenu = ({ children }: { children: React.ReactNode }) => {
  return <div className="flex flex-col gap-1 w-full">{children}</div>;
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
    <div className="relative group">
      <div
        className={
          "absolute inset-0 pointer-events-none mix-blend-multiply bg-repeat bg-size-[150px_150px] bg-[url('https://grainy-gradients.vercel.app/noise.svg')] rounded-md transition-opacity duration-150 " +
          (active
            ? "opacity-15"
            : "opacity-0 group-hover:opacity-10")
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
}: {
  href: string;
  icon?: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  const isActiveFn = useIsActive();
  const active = isActiveFn(href);

  const IconBox = Icon ? (
    <Icon
      className={
        "h-4 w-4 transition-colors " +
        (active ? "text-neutral-100" : "text-neutral-200")
      }
    />
  ) : (
    <div className="h-4 w-4 bg-neutral-500/60" />
  );

  return (
    <GlassItemWrapper active={active}>
      <Link
        href={href}
        className={
          "relative z-10 w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium transition-all duration-150 cursor-pointer " +
          (active
            ? "bg-white/10 text-neutral-100 border border-white/20 backdrop-blur-sm"
            : "bg-transparent text-neutral-200 border border-transparent hover:bg-white/6 hover:text-neutral-100 hover:border-white/12 hover:backdrop-blur-sm")
        }
      >
        {IconBox}
        <span>{children}</span>
      </Link>
    </GlassItemWrapper>
  );
}


export function SidebarMenuItemCollapsible({
  icon: Icon,
  label,
  children,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  children: React.ReactNode;
}) {
  const isActiveFn = useIsActive();
  const childItems = React.Children.toArray(children);
  const hasActiveChild = childItems.some((child) => isActiveFn(getChildHref(child)));
  const [open, setOpen] = React.useState(hasActiveChild);

  React.useEffect(() => {
    if (hasActiveChild) setOpen(true);
  }, [hasActiveChild]);

  const activeSelf = hasActiveChild;

  const IconBox = Icon ? (
    <Icon
      className={
        "h-4 w-4 transition-colors " +
        (activeSelf ? "text-neutral-100" : "text-neutral-200")
      }
    />
  ) : (
    <div className="h-4 w-4 bg-neutral-500/60" />
  );

  return (
    <div className="flex flex-col gap-1 w-full">
      <GlassItemWrapper active={activeSelf}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={
            "relative z-10 w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-left transition-all duration-150 cursor-pointer " +
            (activeSelf
              ? "bg-white/10 text-neutral-100 border border-white/20 backdrop-blur-sm"
              : "bg-transparent text-neutral-200 border border-transparent hover:bg-white/6 hover:text-neutral-100 hover:border-white/12 hover:backdrop-blur-sm")
          }
        >
          {IconBox}
          <span>{label}</span>
          <ChevronRight
            className={
              "ml-auto h-4 w-4 transition-transform duration-200 " +
              (open ? "rotate-90" : "") +
              " " +
              (activeSelf ? "text-neutral-100" : "text-neutral-300")
            }
          />
        </button>
      </GlassItemWrapper>

      <div
        className={`
          flex flex-col gap-0.5 border-l border-neutral-600 pl-1.5 ml-4
          overflow-hidden transition-all duration-300
          ${open ? "max-h-64 opacity-100" : "max-h-0 opacity-75"}
        `}
      >
        {childItems}
      </div>
    </div>
  );
}


export function SidebarMenuItemChild({
  href,
  children,
}: {
  href: string;
  children: React.ReactNode;
}) {
  const isActiveFn = useIsActive();
  const active = isActiveFn(href);

  return (
    <GlassItemWrapper active={active}>
      <Link
        href={href}
        className={
          "relative z-10 w-full flex items-center gap-2 rounded-md px-2 py-1 text-sm font-medium transition-all duration-150 " +
          (active
            ? "bg-white/10 text-neutral-100 border border-white/20 backdrop-blur-sm"
            : "bg-transparent text-neutral-200 border border-transparent hover:bg-white/6 hover:text-neutral-100 hover:border-white/12 hover:backdrop-blur-sm")
        }
      >
        {children}
      </Link>
    </GlassItemWrapper>
  );
}
