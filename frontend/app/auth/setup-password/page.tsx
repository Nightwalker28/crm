"use client";

import type { FormEvent } from "react";
import { useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : "Failed to set password";
}

export default function SetupPasswordPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    if (!token) {
      setError("Setup link is missing a token");
      return;
    }

    if (password !== confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await apiFetch("/auth/setup-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(data?.detail ?? data?.message ?? `Status ${res.status}`);
      }

      setSuccess("Password set successfully. Redirecting to login...");
      window.setTimeout(() => router.replace("/auth/login"), 1000);
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-gray-50 to-gray-300 bg-clip-text text-5xl font-lynk text-transparent">
        Set Password
      </h1>

      <p className="mb-6 text-sm text-slate-200/80">Create a password for your account to finish setup.</p>

      <form className="space-y-4 text-left" onSubmit={handleSubmit}>
        <div className="space-y-2">
          <Label htmlFor="setup-password">Password</Label>
          <Input
            id="setup-password"
            type="password"
            autoComplete="new-password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
          />
          <p className="text-xs text-slate-300/80">Use at least 12 characters.</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="setup-confirm-password">Confirm Password</Label>
          <Input
            id="setup-confirm-password"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full cursor-pointer rounded-md border border-white/20 bg-white px-4 py-3 text-sm font-medium text-black transition-all hover:bg-white/90 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isSubmitting ? "Saving..." : "Set Password"}
        </button>
      </form>

      {success && <p className="mt-3 text-xs text-emerald-300">{success}</p>}
      {error && <p className="mt-3 text-xs text-red-300">{error}</p>}
    </>
  );
}
