"use client";

import type { FormEvent } from "react";
import { Suspense, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CLIENT_TOKEN_STORAGE_KEY, clientLogin } from "@/hooks/useClientPortal";

function getError(error: unknown) {
  return error instanceof Error ? error.message : "Failed to sign in.";
}

function ClientLoginContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = useMemo(() => searchParams.get("redirect") || "/client/login", [searchParams]);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const result = await clientLogin({ email, password });
      window.localStorage.setItem(CLIENT_TOKEN_STORAGE_KEY, result.access_token);
      router.replace(redirect.startsWith("/client/") ? redirect : "/client/login");
      router.refresh();
    } catch (submitError) {
      setError(getError(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-10 text-neutral-100">
      <div className="mx-auto flex min-h-[calc(100vh-5rem)] max-w-md flex-col justify-center">
        <div className="mb-8">
          <div className="mb-3 font-lynk text-4xl text-white">Lynk</div>
          <h1 className="text-2xl font-semibold">Client sign in</h1>
          <p className="mt-2 text-sm text-neutral-400">Sign in to view personalized pricing for shared pages.</p>
        </div>

        <form className="space-y-4 rounded-md border border-neutral-800 bg-neutral-900 p-5" onSubmit={handleSubmit}>
          <div>
            <label className="mb-2 block text-sm font-medium">Email</label>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Password</label>
            <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </div>
          <Button type="submit" className="w-full" disabled={isSubmitting}>
            {isSubmitting ? "Signing in..." : "Sign In"}
          </Button>
          {error ? <p className="text-sm text-red-300">{error}</p> : null}
        </form>
      </div>
    </main>
  );
}

export default function ClientLoginPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-neutral-950 p-8 text-sm text-neutral-400">Loading sign in...</main>}>
      <ClientLoginContent />
    </Suspense>
  );
}
