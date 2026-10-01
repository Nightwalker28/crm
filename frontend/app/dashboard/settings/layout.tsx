import type { ReactNode } from "react";

/**
 * Settings renders in the dashboard shell's own document scroll, like every other page.
 *
 * It carried a second navigation rail (A8) beside the main sidebar, which put two navs on
 * screen for one destination. The owner removed it (2026-10-01): the sidebar's single
 * Settings entry opens the hub, the hub is the index, and a settings page offers the way
 * back through the back arrow in the dashboard header (`app/dashboard/layout.tsx`).
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return children;
}
