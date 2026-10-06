import type { ReactNode } from "react";

import { AuthAtmosphere } from "@/components/auth/AuthAtmosphere";

/**
 * The atmosphere moved to `AuthAtmosphere` so `/client/login` and `/client/setup` can take
 * the same door (rebuild 5.8, ruling 3) — they sit outside this route segment, so a layout
 * cannot reach them. The raw `rgba()` this file carried is tokenised there, not deleted:
 * §9 records that the auth surface's atmosphere is intent, and that a cleanup making a
 * screen more correct and less itself has gone wrong.
 */
export default function AuthLayout({ children }: { children: ReactNode }) {
  return <AuthAtmosphere>{children}</AuthAtmosphere>;
}
