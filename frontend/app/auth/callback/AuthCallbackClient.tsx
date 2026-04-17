"use client";

import { useEffect, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

export default function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const status = useMemo(() => {
    const statusRaw = searchParams.get("status");
    return (statusRaw ?? "error").toLowerCase();
  }, [searchParams]);

  useEffect(() => {
    if (status === "active") {
      router.replace("/dashboard");
    }
  }, [router, status]);

  const message = (() => {
    if (status === "forbidden") return "Your account must be added by an administrator before Google sign-in can be used.";
    if (status === "inactive") return "Your account has been deactivated. Please contact an administrator.";
    if (status === "error") return "Something went wrong during login";
    if (status === "active") return null;
    return "Login failed";
  })();

  if (message === null) return null;

  // Error UI (wrapped by app/auth/layout.tsx)
  return (
    <>
      <Image
        src="/error.png"
        alt="error"
        width={240}
        height={240}
        className="mx-auto mb-3 w-60 invert"
        priority
      />

      <p className="mb-5 text-sm text-slate-300">{message}</p>

      <button
        onClick={() => router.push("/auth/login")}
        className="group relative mt-2 w-full overflow-hidden rounded-md 
                   border border-white/25 bg-neutral-950/90 px-4 py-3 
                   text-sm font-medium text-neutral-50 shadow-[0_0_15px_rgba(0,0,0,0.45)] 
                   backdrop-blur-sm transition-all duration-300 
                   hover:-translate-y-0.5 hover:border-white/60 
                   hover:shadow-[0_12px_25px_rgba(0,0,0,0.65)] 
                   cursor-pointer"
      >
        <span
          className="pointer-events-none absolute inset-0 
                     opacity-0 transition-opacity duration-500 
                     bg-[radial-gradient(circle_at_15%_20%,rgba(255,255,255,0.10),transparent_65%),radial-gradient(circle_at_85%_80%,rgba(255,255,255,0.06),transparent_65%)]
                     group-hover:opacity-100"
        />

        <span className="relative z-10 flex items-center justify-center gap-3">
          Back to Login
        </span>
      </button>
    </>
  );
}
