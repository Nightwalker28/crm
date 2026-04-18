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

            // 3. Base Styles (Glassmorphism)
            "!backdrop-blur-md !shadow-lg",
            "!bg-neutral-600/20 !border-neutral-200/20 !text-neutral-50",

            // 4. Colors
            "data-[type=success]:!bg-emerald-900/20 data-[type=success]:!border-emerald-500/20 data-[type=success]:!text-emerald-50",
            "data-[type=error]:!bg-red-900/20 data-[type=error]:!border-red-500/20 data-[type=error]:!text-red-50",
            "data-[type=warning]:!bg-amber-900/20 data-[type=warning]:!border-amber-500/20 data-[type=warning]:!text-amber-50",
            "data-[type=info]:!bg-blue-900/20 data-[type=info]:!border-blue-500/20 data-[type=info]:!text-blue-50",
          ].join(" "),
          
          description: "group-[.toast]:text-inherit opacity-80 font-normal",
          
          actionButton:
            "group-[.toast]:bg-neutral-50 group-[.toast]:text-neutral-950 font-semibold shadow-sm",
            
          cancelButton:
            "group-[.toast]:bg-white/10 group-[.toast]:text-neutral-50 hover:group-[.toast]:bg-white/20",
        },
      }}
      icons={{
        success: <CircleCheckIcon className="size-5 text-emerald-400" />,
        info: <InfoIcon className="size-5 text-blue-400" />,
        warning: <TriangleAlertIcon className="size-5 text-amber-400" />,
        error: <OctagonXIcon className="size-5 text-red-400" />,
        loading: <Loader2Icon className="size-5 animate-spin text-neutral-400" />,
      }}
      {...props}
    />
  )
}

export { Toaster }
