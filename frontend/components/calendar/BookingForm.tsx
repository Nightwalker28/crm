"use client";

import { useEffect, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";

type BookingQuestion = {
  id?: number | null;
  label: string;
  field_type: string;
  required: boolean;
  sort_order: number;
};

type PublicBookingType = {
  name: string;
  slug: string;
  duration_minutes: number;
  timezone: string;
  owner_name?: string | null;
  questions: BookingQuestion[];
};

type PublicSlot = {
  start_at: string;
  end_at: string;
  label: string;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

async function readJson(res: Response) {
  return res.json().catch(() => null);
}

async function fetchBookingType(slug: string) {
  const res = await apiFetch(`/booking-links/${slug}`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body as PublicBookingType;
}

async function fetchSlots(slug: string, startDate: string, endDate: string) {
  const params = new URLSearchParams({ start_date: startDate, end_date: endDate });
  const res = await apiFetch(`/booking-links/${slug}/slots?${params.toString()}`);
  const body = await readJson(res);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return (body?.results ?? []) as PublicSlot[];
}

async function submitBooking(slug: string, payload: Record<string, unknown>) {
  const res = await apiFetch(`/booking-links/${slug}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await readJson(res);
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
  return body;
}

export default function BookingForm({ slug }: { slug: string }) {
  const [bookingType, setBookingType] = useState<PublicBookingType | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [booked, setBooked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setLoading(true);
        setError("");
        const [typeData, slotData] = await Promise.all([
          fetchBookingType(slug),
          fetchSlots(slug, todayIso(), addDaysIso(14)),
        ]);
        if (cancelled) return;
        setBookingType(typeData);
        setSlots(slotData);
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "Booking link is unavailable.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [slug]);

  async function handleSubmit() {
    if (!selectedSlot) return;
    try {
      setSubmitting(true);
      setError("");
      await submitBooking(slug, {
        start_at: selectedSlot.start_at,
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim(),
        guest_note: guestNote.trim() || null,
        answers,
      });
      setBooked(true);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to book this meeting.");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return <Card className="px-5 py-5 text-sm text-neutral-500">Loading booking link...</Card>;
  }
  if (error && !bookingType) {
    return <Card className="px-5 py-5 text-sm text-red-300">{error}</Card>;
  }
  if (!bookingType) return null;
  if (booked) {
    return (
      <Card className="px-6 py-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-300" />
        <h1 className="mt-4 text-xl font-semibold text-neutral-100">Meeting booked</h1>
        <p className="mt-2 text-sm text-neutral-400">Your time is confirmed with {bookingType.owner_name || "the team"}.</p>
      </Card>
    );
  }

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <Card className="px-5 py-5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-neutral-800 bg-neutral-950">
            <CalendarDays className="h-5 w-5 text-neutral-300" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-neutral-100">{bookingType.name}</h1>
            <p className="mt-1 text-sm text-neutral-400">{bookingType.owner_name || "Lynk"} · {bookingType.timezone}</p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 text-sm text-neutral-300">
          <Clock3 className="h-4 w-4 text-neutral-500" />
          {bookingType.duration_minutes} minutes
        </div>
      </Card>

      <Card className="px-5 py-5">
        <div className="grid gap-5 xl:grid-cols-2">
          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Choose a time</h2>
            <div className="mt-3 grid max-h-[28rem] gap-2 overflow-y-auto pr-1">
              {slots.length ? slots.map((slot) => (
                <button
                  key={slot.start_at}
                  type="button"
                  onClick={() => setSelectedSlot(slot)}
                  className={`rounded-md border px-3 py-3 text-left text-sm transition ${
                    selectedSlot?.start_at === slot.start_at
                      ? "border-emerald-500 bg-emerald-950/40 text-emerald-100"
                      : "border-neutral-800 bg-neutral-950 text-neutral-200 hover:border-neutral-700"
                  }`}
                >
                  {formatDateTime(slot.start_at, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                </button>
              )) : <div className="rounded-md border border-dashed border-neutral-800 px-3 py-5 text-sm text-neutral-500">No slots are available in the next two weeks.</div>}
            </div>
          </div>

          <div>
            <h2 className="text-sm font-semibold text-neutral-100">Your details</h2>
            <FieldGroup className="mt-3 grid gap-3">
              <Field>
                <FieldLabel>Name</FieldLabel>
                <Input value={guestName} onChange={(event) => setGuestName(event.target.value)} />
              </Field>
              <Field>
                <FieldLabel>Email</FieldLabel>
                <Input type="email" value={guestEmail} onChange={(event) => setGuestEmail(event.target.value)} />
              </Field>
              {bookingType.questions.map((question) => {
                const key = String(question.id ?? question.label);
                return (
                  <Field key={key}>
                    <FieldLabel>{question.label}{question.required ? " *" : ""}</FieldLabel>
                    {question.field_type === "textarea" ? (
                      <Textarea value={answers[key] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))} />
                    ) : (
                      <Input value={answers[key] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))} />
                    )}
                  </Field>
                );
              })}
              <Field>
                <FieldLabel>Note</FieldLabel>
                <Textarea value={guestNote} onChange={(event) => setGuestNote(event.target.value)} />
              </Field>
            </FieldGroup>
            {error ? <div className="mt-3 rounded-md border border-red-800 bg-red-950/40 px-3 py-2 text-sm text-red-200">{error}</div> : null}
            <Button className="mt-4 w-full" onClick={handleSubmit} disabled={!selectedSlot || !guestName.trim() || !guestEmail.trim() || submitting}>
              {submitting ? "Booking..." : "Book meeting"}
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
