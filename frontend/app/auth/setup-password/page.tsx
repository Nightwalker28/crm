"use client";

import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { NewPasswordForm } from "@/components/auth/NewPasswordForm";
import { apiFetch } from "@/lib/api";

function SetupPasswordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit(password: string) {
    setError(null);
    setSuccess(null);
    if (!token) {
      setError("Setup link is missing a token");
      return;
    }
    try {
      const res = await apiFetch("/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      await res.json().catch(() => null);
      if (!res.ok) throw new Error("setup failed");
      setSuccess("Password set successfully. Redirecting to login…");
      window.setTimeout(() => router.replace("/auth/login"), 1000);
    } catch {
      setError("The password could not be set. Check the requirements or request a new setup link.");
    }
  }

  return (
    <>
      {/* The wordmark, at the door's one size — it was `font-lynk text-5xl` reading "Set
          Password", which is the brand face doing a page heading's job (§3.1: `.font-lynk`
          is the wordmark, never product UI). The task's name moves to the line under it,
          which is where `/auth/login` has always put it. */}
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>

      <p className="mb-6 text-sm text-copy-secondary">Set a password to finish setting up your account.</p>

      <NewPasswordForm idPrefix="setup" submitLabel="Set password" submittingLabel="Saving…" onSubmit={submit} />

      {success && <p className="mt-3 text-xs text-state-success">{success}</p>}
      {error && <p className="mt-3 text-xs text-state-danger">{error}</p>}
    </>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-copy-secondary">Loading setup link…</p>}>
      <SetupPasswordPageContent />
    </Suspense>
  );
}
