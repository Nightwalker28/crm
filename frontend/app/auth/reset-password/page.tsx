"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";

import { NewPasswordForm } from "@/components/auth/NewPasswordForm";
import { TextLink } from "@/components/ui/TextLink";
import { apiFetch } from "@/lib/api";

function detailMessage(data: unknown, fallback: string) {
  const detail = (data as { detail?: unknown } | null)?.detail;
  return typeof detail === "string" && detail ? detail : fallback;
}

/** The forgot-password door's second half: the emailed link lands here (13 F0.7 B3). */
function ResetPasswordPageContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(password: string) {
    setError(null);
    try {
      const res = await apiFetch("/auth/password/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(detailMessage(data, "The password could not be changed. Check the requirements and try again."));
        return;
      }
      setDone(true);
    } catch {
      setError("The password could not be changed. Check your connection and try again.");
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>

      {done ? (
        <div role="status" className="space-y-4">
          <p className="text-sm text-copy-secondary">
            Your password is changed, and every other device is signed out.
          </p>
          <TextLink href="/auth/login" className="text-sm">
            Sign in
          </TextLink>
        </div>
      ) : !token ? (
        <div role="alert" className="space-y-4">
          <p className="text-sm text-copy-secondary">This reset link is incomplete. Request a new one.</p>
          <TextLink href="/auth/forgot-password" className="text-sm">
            Request a new link
          </TextLink>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-copy-secondary">Choose a new password.</p>
          <NewPasswordForm idPrefix="reset" submitLabel="Change password" submittingLabel="Saving…" onSubmit={submit} />
          {error ? (
            <div className="mt-3 space-y-2 text-left">
              <p role="alert" className="text-xs text-state-danger">{error}</p>
              <TextLink href="/auth/forgot-password" className="text-xs">
                Request a new link
              </TextLink>
            </div>
          ) : null}
        </>
      )}
    </>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-copy-secondary">Loading reset link…</p>}>
      <ResetPasswordPageContent />
    </Suspense>
  );
}
