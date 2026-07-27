"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  const { theme = "system" } = useTheme()

  return (
    <Sonner
      theme={theme as ToasterProps["theme"]}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast: [
            // 1. ESSENTIAL LAYOUT (Must be relative for the noise to work!)
            "group toast relative overflow-hidden !transition-all !duration-250 !ease-in-out !animate-fadeIn ",
            
            // 2. The Noise Texture (Positions itself relative to the line above)
            "before:absolute before:inset-0 before:z-[-1]",
            "before:bg-[image:var(--noise-texture)] before:bg-repeat before:bg-[size:140px_140px]",
            "before:opacity-[0.1] before:mix-blend-overlay before:content-['']",

            // 3. Base Styles
            "!border-line-default !bg-surface-raised/95 !text-copy-primary !shadow-[var(--shadow-panel)] !backdrop-blur-md",

            // 4. Colors
            "data-[type=success]:!border-state-success/40 data-[type=success]:!bg-state-success-muted",
            "data-[type=error]:!border-state-danger/40 data-[type=error]:!bg-state-danger-muted",
            "data-[type=warning]:!border-state-warning/40 data-[type=warning]:!bg-state-warning-muted",
            "data-[type=info]:!border-state-info/40 data-[type=info]:!bg-state-info-muted",
          ].join(" "),
          
          description: "group-[.toast]:text-inherit opacity-80 font-normal",
          
          actionButton:
            "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground font-semibold shadow-sm",
            
          cancelButton:
            "group-[.toast]:bg-surface-muted group-[.toast]:text-copy-secondary hover:group-[.toast]:bg-surface",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-5 text-state-success" />,
        info: <InfoIcon className="size-5 text-state-info" />,
        warning: <TriangleAlertIcon className="size-5 text-state-warning" />,
        error: <OctagonXIcon className="size-5 text-state-danger" />,
        loading: <Loader2Icon className="size-5 animate-spin text-copy-muted" />,
      }}
      {...props}
    />
  )
}

export { Toaster }
