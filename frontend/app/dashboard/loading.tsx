"use client";

import LynkSplash from "@/components/LynkSplash";

export default function DashboardLoading() {
  return (
    <div className="fixed inset-0 z-[100] min-h-screen">
      <LynkSplash />
    </div>
  );
}
