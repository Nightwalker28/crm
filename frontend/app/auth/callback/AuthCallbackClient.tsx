"use client";

import { useEffect, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AlertTriangle } from "lucide-react";

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

  // Error UI, wrapped by app/auth/layout.tsx — the door's atmosphere is `AuthAtmosphere`'s.
  return (
    <div role="alert">
      {/* A 240px `/error.png` under a blanket `invert` stood here. `invert` is theme-blind:
          it is tuned for the dark ground and flips the wrong way in light, and the raster
          was carrying no information the line beneath it did not. */}
      <AlertTriangle className="mx-auto mb-4 size-8 text-state-danger" aria-hidden="true" />

      <p className="mb-5 text-sm text-copy-secondary">{message}</p>

      <Button
        type="button"
        onClick={() => router.push("/auth/login")}
        className="mt-2 w-full"
      >
        Back to sign in
      </Button>
    </div>
  );
}
