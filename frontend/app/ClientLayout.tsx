import { ReactNode } from "react";

/**
 * Shell wrapper. Deliberately does not render the splash.
 *
 * It used to overlay LynkSplash on every mount behind a hardcoded 800ms floor
 * with `authLoading` pinned to false - so it was never waiting on anything, it
 * just made the app feel slow to anyone who opens it thirty times a day.
 *
 * The splash now lives in app/loading.tsx alone, where Next renders it while
 * the root segment is genuinely loading. Route changes inside the dashboard get
 * skeletons from their own loading.tsx files, so the shell never blanks.
 */
export default function ClientLayout({ children }: { children: ReactNode }) {
  return <div className="relative min-h-screen">{children}</div>;
}
