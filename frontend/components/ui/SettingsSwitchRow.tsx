"use client";

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type SettingsSwitchProps = {
  "aria-label"?: string;
  checked: boolean;
  className?: string;
  disabled?: boolean;
  id?: string;
  onCheckedChange: (checked: boolean) => void;
};

export function SettingsSwitch({
  checked,
  className,
  disabled,
  id,
  onCheckedChange,
  "aria-label": ariaLabel,
}: SettingsSwitchProps) {
  return (
    <div
      id={id}
      role="group"
      aria-label={ariaLabel}
      className={cn(
        "inline-grid shrink-0 grid-cols-2 rounded-[var(--radius-control)] border border-line-default bg-surface p-0.5",
        disabled && "opacity-50",
        className,
      )}
    >
      <button
        type="button"
        aria-pressed={!checked}
        disabled={disabled}
        onClick={() => {
          if (checked) onCheckedChange(false);
        }}
        className={cn(
          "min-w-12 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1.5 text-xs font-semibold transition-colors",
          "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          "disabled:cursor-not-allowed",
          !checked
            ? "bg-surface-raised text-copy-primary"
            : "text-copy-muted hover:text-copy-primary",
        )}
      >
        Off
      </button>
      <button
        type="button"
        aria-pressed={checked}
        disabled={disabled}
        onClick={() => {
          if (!checked) onCheckedChange(true);
        }}
        className={cn(
          "min-w-12 rounded-[calc(var(--radius-control)-2px)] px-2.5 py-1.5 text-xs font-semibold transition-colors",
          "focus-visible:relative focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus",
          "disabled:cursor-not-allowed",
          checked
            ? "bg-action-primary text-primary-foreground"
            : "text-copy-muted hover:text-copy-primary",
        )}
      >
        On
      </button>
    </div>
  );
}

type SettingsSwitchRowProps = SettingsSwitchProps & {
  compact?: boolean;
  description?: ReactNode;
  label: ReactNode;
};

export function SettingsSwitchRow({
  checked,
  className,
  compact = false,
  description,
  disabled,
  id,
  label,
  onCheckedChange,
}: SettingsSwitchRowProps) {
  return (
    <div
      className={cn(
        "flex items-center justify-between gap-4 rounded-[var(--radius-control)] border border-line-default bg-surface-muted",
        compact ? "min-h-10 px-3 py-2" : "min-h-14 px-4 py-3",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="text-sm font-medium text-copy-primary">{label}</div>
        {description ? <p className="mt-0.5 text-p-xs text-copy-muted">{description}</p> : null}
      </div>
      <SettingsSwitch
        id={id}
        aria-label={typeof label === "string" ? label : undefined}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onCheckedChange}
      />
    </div>
  );
}
