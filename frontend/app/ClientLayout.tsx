"use client";

import { ReactNode, useEffect, useState } from "react";
import LynkSplash from "@/components/LynkSplash";
// import { useSession } from "next-auth/react"; // if you use next auth

type ClientLayoutProps = {
  children: ReactNode;
};

const MIN_SPLASH_TIME = 3000; // milliseconds

// set this to false when you are done designing the splash
const DEV_ALWAYS_SHOW_SPLASH = false;

export default function ClientLayout(props: ClientLayoutProps) {
  const { children } = props;
  const [showSplash, setShowSplash] = useState(true);
  const [mountedAt] = useState(() => Date.now());

  // If you use next auth, you can turn this into real auth loading
  // const { status } = useSession();
  // const authLoading = status === "loading";

  const authLoading = false;

  useEffect(() => {
    let timeoutId: number | undefined;

    if (!DEV_ALWAYS_SHOW_SPLASH && !authLoading) {
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(MIN_SPLASH_TIME - elapsed, 0);

      timeoutId = window.setTimeout(() => {
        setShowSplash(false);
      }, remaining);
    }

    return () => {
      if (timeoutId !== undefined) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [authLoading, mountedAt]);

  if (DEV_ALWAYS_SHOW_SPLASH) {
    return (
      <div className="relative min-h-screen">
        <LynkSplash />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen">
      {/* Splash overlay */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-500 ${
          showSplash
            ? "opacity-100 pointer-events-auto"
            : "opacity-0 pointer-events-none"
        }`}
      >
        <LynkSplash />
      </div>

      {/* App content */}
      <div
        className={`min-h-screen transition-opacity duration-500 ${
          showSplash ? "opacity-0" : "opacity-100"
        }`}
      >
        {children}
      </div>
    </div>
  );
}
