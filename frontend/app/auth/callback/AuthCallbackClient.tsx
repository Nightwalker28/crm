"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

import { Button } from "@/components/ui/button";
import { publishAuthSessionChange } from "@/lib/authSessionEvents";

export default function AuthCallbackClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectedRef = useRef(false);

  const status = useMemo(() => {
    const statusRaw = searchParams.get("status");
    return (statusRaw ?? "error").toLowerCase();
  }, [searchParams]);

  useEffect(() => {
    if (status === "active" && !redirectedRef.current) {
      redirectedRef.current = true;
      publishAuthSessionChange();
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

      <p className="mb-5 text-sm text-copy-secondary">{message}</p>

      <Button
        type="button"
        onClick={() => router.push("/auth/login")}
        className="mt-2 w-full"
      >
        Back to Login
      </Button>
    </>
  );
}
