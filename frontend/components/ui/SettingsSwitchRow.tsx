"use client";

import type { ReactNode } from "react";

import { Switch, SwitchThumb } from "@/components/ui/switch";
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
    <Switch
      id={id}
      aria-label={ariaLabel}
      checked={checked}
      disabled={disabled}
      onCheckedChange={onCheckedChange}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 rounded-full border border-line-strong bg-surface-raised p-0.5 shadow-inner transition-colors",
        "data-[state=checked]:border-action-primary data-[state=checked]:bg-action-primary",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className,
      )}
    >
      <SwitchThumb className="block h-5 w-5 translate-x-0 rounded-full bg-copy-primary shadow-sm data-[state=checked]:translate-x-5" />
    </Switch>
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
        <label htmlFor={id} className="block cursor-pointer text-sm font-medium text-copy-primary">
          {label}
        </label>
        {description ? <p className="mt-0.5 text-xs leading-5 text-copy-muted">{description}</p> : null}
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
