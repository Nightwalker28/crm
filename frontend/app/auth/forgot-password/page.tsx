"use client";

import type { FormEvent } from "react";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TextLink } from "@/components/ui/TextLink";
import { apiFetch } from "@/lib/api";

/**
 * Forgot password (13 F0.7 B3). The answer is the same whether or not the address has an
 * account, so the page never tells anyone which addresses exist.
 */
function ForgotPasswordPageContent() {
  const searchParams = useSearchParams();
  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sentMessage, setSentMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsSubmitting(true);
    try {
      const res = await apiFetch("/auth/password/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = await res.json().catch(() => null);
      if (res.status === 429) {
        setError("Too many reset requests. Wait a while, then try again.");
        return;
      }
      if (!res.ok) {
        setError(res.status === 422 ? "Enter a valid email address." : "The request could not be sent. Try again.");
        return;
      }
      setSentMessage(typeof data?.message === "string" ? data.message : "If an account uses that email, a reset link is on its way.");
    } catch {
      setError("The request could not be sent. Check your connection and try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <>
      <h1 className="mb-3 bg-linear-to-b from-copy-primary to-copy-secondary bg-clip-text font-lynk text-7xl text-transparent">
        Lynk
      </h1>

      {sentMessage ? (
        <div role="status" className="space-y-4">
          <p className="text-sm text-copy-secondary">{sentMessage}</p>
          <TextLink href="/auth/login" className="text-sm">
            Back to sign in
          </TextLink>
        </div>
      ) : (
        <>
          <p className="mb-6 text-sm text-copy-secondary">Enter your email and we will send you a link to choose a new password.</p>
          <form className="space-y-4 text-left" onSubmit={handleSubmit}>
            <div className="space-y-2">
              <Label htmlFor="forgot-email">Email</Label>
              <Input
                id="forgot-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                required
              />
            </div>
            <Button type="submit" disabled={isSubmitting} className="w-full">
              {isSubmitting ? "Sending…" : "Send reset link"}
            </Button>
          </form>
          {error ? <p role="alert" className="mt-3 text-xs text-state-danger">{error}</p> : null}
          <div className="mt-4">
            <TextLink href="/auth/login" className="text-xs">
              Back to sign in
            </TextLink>
          </div>
        </>
      )}
    </>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordPageContent />
    </Suspense>
  );
}
