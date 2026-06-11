"use client";

import type { FormEvent } from "react";
import Link from "next/link";
import { ArrowRight, HelpCircle, Plus } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useClientSupportActions, useClientSupportCases } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

const CATEGORIES = [
  { value: "general", label: "General" },
  { value: "billing", label: "Billing" },
  { value: "technical", label: "Technical" },
  { value: "order", label: "Order" },
  { value: "account", label: "Account" },
];

const PRIORITIES = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "urgent", label: "Urgent" },
];

function statusLabel(value: string) {
  return value.replaceAll("_", " ");
}

export default function ClientSupportPage() {
  const casesQuery = useClientSupportCases();
  const { createCase, isCreatingCase } = useClientSupportActions();
  const cases = casesQuery.data?.results ?? [];
  const [subject, setSubject] = useState("");
  const [category, setCategory] = useState("general");
  const [priority, setPriority] = useState("medium");
  const [description, setDescription] = useState("");

  async function submitTicket(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!subject.trim()) return;
    try {
      const created = await createCase({
        subject: subject.trim(),
        category,
        priority,
        description: description.trim() || null,
      });
      setSubject("");
      setCategory("general");
      setPriority("medium");
      setDescription("");
      toast.success(`Ticket ${created.case_number} created.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to create support ticket.");
    }
  }

  return (
    <main className="min-h-screen bg-neutral-950 text-neutral-100">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-800 pb-4">
          <Link href="/client" className="font-lynk text-3xl text-white">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-neutral-400">
            <HelpCircle className="h-4 w-4" />
            Client support
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-neutral-50">Support tickets</h1>
        </section>

        <div className="grid gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <section className="h-fit rounded-md border border-neutral-800 bg-neutral-900 p-5">
            <div className="flex items-center gap-2">
              <Plus className="h-4 w-4 text-neutral-400" />
              <h2 className="text-base font-semibold text-neutral-100">Create ticket</h2>
            </div>
            <form className="mt-4 grid gap-4" onSubmit={(event) => void submitTicket(event)}>
              <Field>
                <FieldLabel>Subject <RequiredMark /></FieldLabel>
                <Input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="What do you need help with?" required />
              </Field>
              <Field>
                <FieldLabel>Category</FieldLabel>
                <Select value={category} onValueChange={setCategory}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{CATEGORIES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Priority</FieldLabel>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{PRIORITIES.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} placeholder="Add the details your support team needs." />
              </Field>
              <Button type="submit" disabled={!subject.trim() || isCreatingCase}>
                {isCreatingCase ? "Creating..." : "Create Ticket"}
              </Button>
            </form>
          </section>

          <section>
            {casesQuery.isLoading ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">Loading tickets...</div>
            ) : casesQuery.error ? (
              <div className="rounded-md border border-red-900/60 bg-red-950/20 p-5 text-sm text-red-200">
                {casesQuery.error instanceof Error ? casesQuery.error.message : "Failed to load support tickets."}
              </div>
            ) : cases.length === 0 ? (
              <div className="rounded-md border border-neutral-800 bg-neutral-900 p-8 text-center text-sm text-neutral-500">No support tickets yet.</div>
            ) : (
              <div className="grid gap-3">
                {cases.map((item) => (
                  <Link key={item.id} href={`/client/support/${item.id}`} className="group rounded-md border border-neutral-800 bg-neutral-900 p-4 transition-colors hover:border-neutral-600 hover:bg-neutral-800/70">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-xs uppercase text-neutral-500">{item.case_number}</div>
                        <h2 className="mt-1 truncate font-semibold text-neutral-100">{item.subject}</h2>
                        <p className="mt-1 text-xs text-neutral-500">{formatDateTime(item.updated_at)}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <div className="capitalize text-neutral-300">{statusLabel(item.status)}</div>
                          <div className="text-xs capitalize text-neutral-500">{item.category || "general"} · {item.priority}</div>
                        </div>
                        <ArrowRight className="h-4 w-4 text-neutral-500 transition-transform group-hover:translate-x-0.5" />
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
