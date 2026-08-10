"use client";

import { useRef, useState } from "react";

import { QuickCreateSurface, type QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

export function QuickCreateSurfaceHarness() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [submitCount, setSubmitCount] = useState(0);
  const [lastOutcome, setLastOutcome] = useState<QuickCreateOutcome | "more-details" | "none">("none");
  const [failNextSubmit, setFailNextSubmit] = useState(false);
  const openerRef = useRef<HTMLButtonElement>(null);

  async function submit(outcome: QuickCreateOutcome) {
    setSubmitCount((count) => count + 1);
    setLastOutcome(outcome);
    if (failNextSubmit) {
      setFailNextSubmit(false);
      await new Promise((resolve) => window.setTimeout(resolve, 300));
      throw new Error("Fixture submission failed");
    }
    await new Promise((resolve) => window.setTimeout(resolve, 1_000));
  }

  return (
    <main className="min-h-screen bg-app p-6 text-copy-primary">
      <div aria-label="Preserved page context" className="max-w-xl rounded-[var(--radius-card)] border border-line-default bg-surface p-6">
        <h1 className="text-xl font-semibold">Interaction surface harness</h1>
        <p className="mt-2 text-sm text-copy-muted">Neutral behavior fixture; it is not connected to a CRM module.</p>
        <Button ref={openerRef} className="mt-5" type="button" onClick={() => setOpen(true)}>
          Open quick create
        </Button>
        <Button
          className="ml-2 mt-5"
          type="button"
          variant="outline"
          aria-pressed={failNextSubmit}
          onClick={() => setFailNextSubmit(true)}
        >
          Fail next submission
        </Button>
        <dl className="mt-5 text-sm">
          <div>Submit count: <span data-testid="submit-count">{submitCount}</span></div>
          <div>Last outcome: <span data-testid="last-outcome">{lastOutcome}</span></div>
        </dl>
      </div>

      <QuickCreateSurface
        open={open}
        onOpenChange={setOpen}
        title="Create test record"
        description="Verify the shared interaction contract."
        returnFocusRef={openerRef}
        isDirty={name.length > 0}
        statusMessage={name ? "Unsaved changes" : "Ready to create"}
        onSubmit={submit}
        onMoreDetails={() => setLastOutcome("more-details")}
      >
        {({ submit: submitFromForm }) => (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submitFromForm("create");
            }}
          >
            <Field>
              <FieldLabel htmlFor="quick-create-test-name">Name</FieldLabel>
              <Input
                id="quick-create-test-name"
                value={name}
                onChange={(event) => setName(event.target.value)}
              />
            </Field>
            <Button type="button" variant="outline" size="lg" className="mt-4">
              Last focusable body control
            </Button>
          </form>
        )}
      </QuickCreateSurface>
    </main>
  );
}
