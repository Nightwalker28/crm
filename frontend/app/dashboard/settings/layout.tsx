import type { ReactNode } from "react";

import { SettingsNavRail } from "@/components/settings/SettingsNavRail";

/**
 * Archetype 4's shell: a 16rem rail and a content column that owns the scroll.
 *
 * This was a five-line passthrough, which is why A8 existed — with no lateral navigation,
 * every two-page settings task went back through the hub. The mechanism is archetype 2's,
 * not `position: sticky`: a full-height row whose two columns each scroll their own
 * overflow, so the page itself never scrolls and §4.5 holds at one *page* scroll region.
 * R3 stands — no new sticky enters the app for this.
 *
 * The height applies from `lg` only. Below it the rail is dropped and the page reverts to a
 * document scroll inside the dashboard shell's scroller, with the hub as the narrow-viewport
 * index — the same call archetype 2 makes when its spine stacks.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col lg:h-full lg:min-h-0 lg:flex-row lg:gap-8">
      {/* `-mx-2 px-2`: the active item's focus ring and its left bar bleed past the link's
          box, and inside a scroll container that bleed becomes horizontal overflow. The
          negative margin gives it room without moving the column. Same fix as `RecordSpine`. */}
      <div className="hidden shrink-0 lg:-mx-2 lg:block lg:min-h-0 lg:w-64 lg:overflow-y-auto lg:px-2 lg:pb-6">
        <SettingsNavRail />
      </div>
      <div className="min-w-0 lg:h-full lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pb-6">
        {children}
      </div>
    </div>
  );
}
