"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { useAccessibleModules } from "@/hooks/useAccessibleModules";

export default function DashboardHomePage() {
  const router = useRouter();
  const { modules, isLoading } = useAccessibleModules();

  useEffect(() => {
    if (isLoading) return;

    const firstModule = modules.find((module) => module.base_route);
    if (firstModule?.base_route) {
      router.replace(firstModule.base_route);
      return;
    }

    router.replace("/dashboard/profile");
  }, [isLoading, modules, router]);

  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-neutral-500">
      Loading your dashboard…
    </div>
  );
}
