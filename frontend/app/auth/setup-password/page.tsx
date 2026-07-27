"use client";

import type { FormEvent } from "react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiFetch } from "@/lib/api";

function getErrorMessage() {
  return "The password could not be set. Check the requirements or request a new setup link.";
}

type PasswordPolicy = {
  min_length: number;
  requirements: string[];
};

function SetupPasswordPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const token = useMemo(() => searchParams.get("token") ?? "", [searchParams]);

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [passwordPolicy, setPasswordPolicy] = useState<PasswordPolicy | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    async function loadPasswordPolicy() {
      try {
        const res = await apiFetch("/auth/password-policy", { signal: controller.signal });
        if (!res.ok) {
          return;
        }
        const data = (await res.json()) as PasswordPolicy;
        if (!controller.signal.aborted && Array.isArray(data.requirements)) {
          setPasswordPolicy(data);
        }
      } catch {
        if (controller.signal.aborted) return;
        // Keep generic copy if the policy endpoint is unavailable.
      }
    }

    loadPasswordPolicy();
    return () => {
      controller.abort();
    };
  }, []);

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

      await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error("The password could not be set. Check the requirements or request a new setup link.");
      }

      setSuccess("Password set successfully. Redirecting to login...");
      window.setTimeout(() => router.replace("/auth/login"), 1000);
    } catch {
      setError(getErrorMessage());
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text text-5xl font-lynk text-transparent">
        Set Password
      </h1>

      <p className="mb-6 text-sm text-copy-secondary">Create a password for your account to finish setup.</p>

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
          {passwordPolicy ? (
            <ul className="space-y-1 text-xs text-copy-secondary">
              {passwordPolicy.requirements.map((requirement) => (
                <li key={requirement}>{requirement}</li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-copy-secondary">Password must meet the current security policy.</p>
          )}
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

        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full"
        >
          {isSubmitting ? "Saving..." : "Set Password"}
        </Button>
      </form>

      {success && <p className="mt-3 text-xs text-state-success">{success}</p>}
      {error && <p className="mt-3 text-xs text-state-danger">{error}</p>}
    </>
  );
}

export default function SetupPasswordPage() {
  return (
    <Suspense fallback={<p className="text-sm text-copy-secondary">Loading setup link...</p>}>
      <SetupPasswordPageContent />
    </Suspense>
  );
}
