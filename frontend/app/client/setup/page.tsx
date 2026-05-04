"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { setupClientPassword } from "@/hooks/useClientPortal";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "Failed to set password.";
}

function ClientSetupContent() {
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "done">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (!token) {
      setError("Setup token is missing.");
      return;
    }
    if (password !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    setStatus("saving");
    try {
      await setupClientPassword({ token, password });
      setStatus("done");
    } catch (submitError) {
      setError(getError(submitError));
      setStatus("idle");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-10 text-neutral-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <div className="mb-8">
          <div className="mb-3 font-lynk text-4xl text-white">Lynk</div>
          <h1 className="text-2xl font-semibold">Set client password</h1>
          <p className="mt-2 text-sm text-neutral-400">Create the password for your client portal access.</p>
        </div>

        {status === "done" ? (
          <div className="rounded-md border border-emerald-900/60 bg-emerald-950/20 p-4">
            <div className="text-sm text-emerald-200">Password set. You can now sign in from any shared client page.</div>
            <Button asChild className="mt-4">
              <Link href="/client/login">Go to client login</Link>
            </Button>
          </div>
        ) : (
          <form className="space-y-4 rounded-md border border-neutral-800 bg-neutral-900 p-5" onSubmit={handleSubmit}>
            <div>
              <label className="mb-2 block text-sm font-medium">Password</label>
              <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium">Confirm Password</label>
              <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} required />
            </div>
            <Button type="submit" className="w-full" disabled={status === "saving"}>
              {status === "saving" ? "Saving..." : "Set Password"}
            </Button>
            {error ? <p className="text-sm text-red-300">{error}</p> : null}
          </form>
        )}
      </div>
    </main>
  );
}

export default function ClientSetupPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-neutral-950 p-8 text-sm text-neutral-400">Loading setup link...</main>}>
      <ClientSetupContent />
    </Suspense>
  );
}
