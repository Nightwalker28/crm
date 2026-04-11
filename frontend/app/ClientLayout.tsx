"use client";

import { ReactNode, useEffect, useState } from "react";
import LynkSplash from "@/components/LynkSplash";
// import { useSession } from "next-auth/react"; // if you use next auth

type ClientLayoutProps = {
  children: ReactNode;
};

const MIN_SPLASH_TIME = 900; // milliseconds

// set this to false when you are done designing the splash
const DEV_ALWAYS_SHOW_SPLASH = false;

export default function ClientLayout(props: ClientLayoutProps) {
  const { children } = props;

  const [showSplash, setShowSplash] = useState(true);
  const [mountedAt, setMountedAt] = useState<number | null>(null);

  // If you use next auth, you can turn this into real auth loading
  // const { status } = useSession();
  // const authLoading = status === "loading";

  const authLoading = false;

  // dev mode: always show splash so you see changes instantly
  if (DEV_ALWAYS_SHOW_SPLASH) {
    return (
      <div className="relative min-h-screen">
        <LynkSplash />
      </div>
    );
  }

  useEffect(() => {
    if (mountedAt === null) {
      setMountedAt(Date.now());
    }
  }, [mountedAt]);

  useEffect(() => {
    if (!authLoading && mountedAt !== null) {
      const elapsed = Date.now() - mountedAt;
      const remaining = Math.max(MIN_SPLASH_TIME - elapsed, 0);

      const timeoutId = window.setTimeout(() => {
        setShowSplash(false);
      }, remaining);

      return () => window.clearTimeout(timeoutId);
    }
  }, [authLoading, mountedAt]);

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
