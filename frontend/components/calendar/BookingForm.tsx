"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiUrl } from "@/lib/runtime-config";

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
  owner_handle: string;
  canonical_path: string;
  questions: BookingQuestion[];
};

type PublicSlot = {
  start_at: string;
  end_at: string;
  label: string;
};

type LoadFailure = "unavailable" | "temporary";
type SubmitFailure = "slot" | "rate" | "temporary";

const DISPLAY_TIMEZONES = ["UTC", "America/New_York", "Europe/London", "Asia/Colombo", "Asia/Dubai", "Asia/Singapore", "Australia/Sydney"];
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class BookingLoadError extends Error {
  constructor(readonly kind: LoadFailure) {
    super(kind);
  }
}

class BookingSubmitError extends Error {
  constructor(readonly kind: SubmitFailure) {
    super(kind);
  }
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIso(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function browserTimezone() {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
}

function formatSlotTime(value: string, timeZone: string) {
  try {
    return new Intl.DateTimeFormat("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone,
      timeZoneName: "short",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function isBookingType(value: unknown): value is PublicBookingType {
  if (!value || typeof value !== "object") return false;
  const bookingType = value as Partial<PublicBookingType>;
  return (
    typeof bookingType.name === "string"
    && typeof bookingType.slug === "string"
    && typeof bookingType.duration_minutes === "number"
    && typeof bookingType.timezone === "string"
    && typeof bookingType.owner_handle === "string"
    && typeof bookingType.canonical_path === "string"
    && Array.isArray(bookingType.questions)
  );
}

function isPublicSlot(value: unknown): value is PublicSlot {
  if (!value || typeof value !== "object") return false;
  const slot = value as Partial<PublicSlot>;
  return typeof slot.start_at === "string" && typeof slot.end_at === "string" && typeof slot.label === "string";
}

async function readJson(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

async function publicFetch(path: string, init?: RequestInit) {
  return fetch(apiUrl(path), {
    ...init,
    cache: "no-store",
    credentials: "omit",
    headers: { Accept: "application/json", ...init?.headers },
  });
}

function bookingApiPath(slug: string, ownerHandle?: string) {
  if (!ownerHandle) return `/booking-links/${encodeURIComponent(slug)}`;
  return `/booking-links/owners/${encodeURIComponent(ownerHandle)}/${encodeURIComponent(slug)}`;
}

async function fetchBookingType(slug: string, ownerHandle?: string, signal?: AbortSignal) {
  const response = await publicFetch(bookingApiPath(slug, ownerHandle), { signal });
  const body = await readJson(response);
  if (response.status === 404) throw new BookingLoadError("unavailable");
  if (!response.ok || !isBookingType(body)) throw new BookingLoadError("temporary");
  return body;
}

async function fetchSlots(slug: string, ownerHandle?: string, signal?: AbortSignal) {
  const params = new URLSearchParams({ start_date: todayIso(), end_date: addDaysIso(14) });
  const response = await publicFetch(`${bookingApiPath(slug, ownerHandle)}/slots?${params.toString()}`, { signal });
  const body = await readJson(response);
  if (response.status === 404) throw new BookingLoadError("unavailable");
  if (!response.ok || !body || typeof body !== "object" || !Array.isArray((body as { results?: unknown }).results)) {
    throw new BookingLoadError("temporary");
  }
  return (body as { results: unknown[] }).results.filter(isPublicSlot);
}

async function submitBooking(slug: string, ownerHandle: string | undefined, payload: Record<string, unknown>) {
  const response = await publicFetch(`${bookingApiPath(slug, ownerHandle)}/book`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (response.status === 409) throw new BookingSubmitError("slot");
  if (response.status === 429) throw new BookingSubmitError("rate");
  if (!response.ok) throw new BookingSubmitError("temporary");
}

export default function BookingForm({ slug, ownerHandle }: { slug: string; ownerHandle?: string }) {
  const router = useRouter();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const [bookingType, setBookingType] = useState<PublicBookingType | null>(null);
  const [slots, setSlots] = useState<PublicSlot[]>([]);
  const [selectedSlot, setSelectedSlot] = useState<PublicSlot | null>(null);
  const [guestName, setGuestName] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  const [guestNote, setGuestNote] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [displayTimezone, setDisplayTimezone] = useState(() => browserTimezone());
  const [loading, setLoading] = useState(true);
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  const [slotsError, setSlotsError] = useState(false);
  const [submitError, setSubmitError] = useState<SubmitFailure | null>(null);
  const [validationAttempted, setValidationAttempted] = useState(false);
  const [booked, setBooked] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setLoadError(null);
      setSlotsError(false);
      try {
        const typeData = await fetchBookingType(slug, ownerHandle, controller.signal);
        if (!ownerHandle && typeData.canonical_path) {
          router.replace(typeData.canonical_path);
          return;
        }
        setBookingType(typeData);
        setDisplayTimezone((current) => current || typeData.timezone || browserTimezone());
        try {
          setSlotsLoading(true);
          setSlots(await fetchSlots(slug, ownerHandle, controller.signal));
        } catch (error) {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (error instanceof BookingLoadError && error.kind === "unavailable") {
            setBookingType(null);
            setLoadError("unavailable");
          } else {
            setSlotsError(true);
          }
        } finally {
          if (!controller.signal.aborted) setSlotsLoading(false);
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setBookingType(null);
        setLoadError(error instanceof BookingLoadError ? error.kind : "temporary");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [ownerHandle, reloadKey, router, slug]);

  async function refreshSlots() {
    setSlotsLoading(true);
    setSlotsError(false);
    try {
      setSlots(await fetchSlots(slug, ownerHandle));
    } catch {
      setSlotsError(true);
    } finally {
      setSlotsLoading(false);
    }
  }

  function firstMissingRequiredQuestion() {
    return bookingType?.questions.find((question) => {
      const key = String(question.id ?? question.label);
      return question.required && !answers[key]?.trim();
    });
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSlot || !bookingType) return;
    setValidationAttempted(true);
    setSubmitError(null);
    if (!guestName.trim()) {
      nameRef.current?.focus();
      return;
    }
    if (!EMAIL_PATTERN.test(guestEmail.trim())) {
      emailRef.current?.focus();
      return;
    }
    const missingQuestion = firstMissingRequiredQuestion();
    if (missingQuestion) {
      const key = String(missingQuestion.id ?? missingQuestion.label).replace(/[^a-zA-Z0-9_-]/g, "-");
      document.getElementById(`booking-question-${key}`)?.focus();
      return;
    }

    try {
      setSubmitting(true);
      await submitBooking(slug, ownerHandle, {
        start_at: selectedSlot.start_at,
        guest_name: guestName.trim(),
        guest_email: guestEmail.trim(),
        guest_note: guestNote.trim() || null,
        answers,
      });
      setBooked(true);
    } catch (error) {
      const failure = error instanceof BookingSubmitError ? error.kind : "temporary";
      setSubmitError(failure);
      if (failure === "slot") {
        setSelectedSlot(null);
        await refreshSlots();
      }
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <Card className="flex min-h-64 items-center justify-center p-6" role="status" aria-busy="true">
        <Loader2 className="mr-2 h-4 w-4 animate-spin text-copy-muted" aria-hidden="true" />
        <span className="text-sm text-copy-secondary">Loading booking page…</span>
      </Card>
    );
  }

  if (loadError || !bookingType) {
    return (
      <Card role="alert" className="flex min-h-64 flex-col items-center justify-center border-state-danger/40 bg-state-danger-muted p-6 text-center">
        <CalendarDays className="h-9 w-9 text-state-danger" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-copy-primary">
          {loadError === "unavailable" ? "This booking link is unavailable" : "The booking page could not be loaded"}
        </h1>
        <p className="mt-2 max-w-md text-p-sm text-copy-secondary">
          {loadError === "unavailable"
            ? "The link may be disabled or no longer available. Ask the organizer for an updated link."
            : "Check your connection and try again."}
        </p>
        {loadError === "temporary" ? (
          <Button type="button" variant="outline" className="mt-5" onClick={() => setReloadKey((current) => current + 1)}>
            <RefreshCw />
            Try again
          </Button>
        ) : null}
      </Card>
    );
  }

  if (booked) {
    return (
      <Card className="px-6 py-10 text-center" role="status">
        <CheckCircle2 className="mx-auto h-11 w-11 text-state-success" aria-hidden="true" />
        <h1 className="mt-4 text-xl font-semibold text-copy-primary">Meeting booked</h1>
        <p className="mt-2 text-sm text-copy-secondary">Your time is confirmed with {bookingType.owner_name || "the team"}.</p>
        {selectedSlot ? (
          <p className="mt-3 font-medium text-copy-primary">
            <time dateTime={selectedSlot.start_at}>{formatSlotTime(selectedSlot.start_at, displayTimezone)}</time>
          </p>
        ) : null}
        <div className="mx-auto mt-5 flex max-w-md items-center justify-center gap-2 rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-4 py-3 text-sm text-copy-secondary">
          <ShieldCheck className="h-4 w-4 text-state-success" aria-hidden="true" />
          Confirmation details were sent to the meeting organizer.
        </div>
      </Card>
    );
  }

  const timezoneOptions = Array.from(new Set([browserTimezone(), bookingType.timezone, ...DISPLAY_TIMEZONES]));

  return (
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <Card className="p-5 sm:p-6">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-[var(--radius-control)] border border-line-default bg-surface-muted">
            <CalendarDays className="h-5 w-5 text-copy-secondary" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-copy-primary">{bookingType.name}</h1>
            <p className="mt-1 text-sm text-copy-muted">{bookingType.owner_name || "Lynk"}</p>
          </div>
        </div>
        <div className="mt-5 flex items-center gap-2 text-sm text-copy-secondary">
          <Clock3 className="h-4 w-4 text-copy-muted" aria-hidden="true" />
          {bookingType.duration_minutes} minutes
        </div>
        <Field className="mt-5 rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted p-4">
          <FieldLabel htmlFor="booking-display-timezone">Display timezone</FieldLabel>
          <Select value={displayTimezone} onValueChange={setDisplayTimezone}>
            <SelectTrigger id="booking-display-timezone" className="w-full">
              <SelectValue placeholder="Select timezone" />
            </SelectTrigger>
            <SelectContent>
              {timezoneOptions.map((zone) => <SelectItem key={zone} value={zone}>{zone.replaceAll("_", " ")}</SelectItem>)}
            </SelectContent>
          </Select>
          <FieldDescription>Available times are shown in this timezone.</FieldDescription>
        </Field>
      </Card>

      <Card className="p-5 sm:p-6">
        <div className="grid gap-6 xl:grid-cols-2">
          <section aria-labelledby="booking-times-heading">
            <div className="flex items-center justify-between gap-3">
              <h2 id="booking-times-heading" className="text-sm font-semibold text-copy-primary">Choose a time</h2>
              <Button type="button" variant="ghost" size="sm" onClick={() => void refreshSlots()} disabled={slotsLoading}>
                <RefreshCw className={slotsLoading ? "animate-spin" : undefined} />
                Refresh
              </Button>
            </div>
            {slotsLoading ? (
              <div className="mt-3 flex min-h-32 items-center justify-center rounded-[var(--radius-control)] border border-line-subtle bg-surface-muted text-sm text-copy-muted" role="status">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />
                Loading available times…
              </div>
            ) : slotsError ? (
              <div className="mt-3 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted p-4 text-sm text-copy-secondary" role="alert">
                <p>Available times could not be loaded.</p>
                <Button type="button" variant="outline" size="sm" className="mt-3" onClick={() => void refreshSlots()}>Try again</Button>
              </div>
            ) : slots.length ? (
              <div
                // Bounded on purpose: a day can expose dozens of slots, and an uncapped
                // list would make the page jump on every date change. This is a picker,
                // not page content - see docs/design/design.md 4.5.
                data-bounded-list
                className="mt-3 grid max-h-[28rem] gap-2 overflow-y-auto pr-1"
                role="radiogroup"
                aria-label="Available meeting times"
              >
                {slots.map((slot) => {
                  const selected = selectedSlot?.start_at === slot.start_at;
                  return (
                    <button
                      key={slot.start_at}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => {
                        setSelectedSlot(slot);
                        setSubmitError(null);
                      }}
                      className={`rounded-[var(--radius-control)] border px-3 py-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                        selected
                          ? "border-state-success/60 bg-state-success-muted text-copy-primary"
                          : "border-line-default bg-surface-muted text-copy-secondary hover:border-line-strong hover:bg-surface-raised"
                      }`}
                    >
                      <time dateTime={slot.start_at}>{formatSlotTime(slot.start_at, displayTimezone)}</time>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-[var(--radius-control)] border border-dashed border-line-default bg-surface-muted px-4 py-6 text-sm text-copy-muted">
                No times are available in the next two weeks.
              </div>
            )}
          </section>

          <form onSubmit={handleSubmit} noValidate>
            <h2 className="text-sm font-semibold text-copy-primary">Your details</h2>
            {selectedSlot ? (
              <div className="mt-3 rounded-[var(--radius-control)] border border-state-success/40 bg-state-success-muted px-3 py-2 text-sm text-copy-primary">
                Selected: <time dateTime={selectedSlot.start_at}>{formatSlotTime(selectedSlot.start_at, displayTimezone)}</time>
              </div>
            ) : (
              <p className="mt-3 text-sm text-copy-muted">Choose an available time to continue.</p>
            )}
            <FieldGroup className="mt-4 grid gap-4">
              <Field>
                <FieldLabel htmlFor="booking-guest-name">Name <RequiredMark /></FieldLabel>
                <Input
                  ref={nameRef}
                  id="booking-guest-name"
                  value={guestName}
                  maxLength={160}
                  autoComplete="name"
                  aria-invalid={validationAttempted && !guestName.trim()}
                  aria-describedby={validationAttempted && !guestName.trim() ? "booking-name-error" : undefined}
                  onChange={(event) => setGuestName(event.target.value)}
                />
                {validationAttempted && !guestName.trim() ? <FieldError id="booking-name-error">Enter your name.</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel htmlFor="booking-guest-email">Email <RequiredMark /></FieldLabel>
                <Input
                  ref={emailRef}
                  id="booking-guest-email"
                  type="email"
                  value={guestEmail}
                  maxLength={255}
                  autoComplete="email"
                  inputMode="email"
                  aria-invalid={validationAttempted && !EMAIL_PATTERN.test(guestEmail.trim())}
                  aria-describedby={validationAttempted && !EMAIL_PATTERN.test(guestEmail.trim()) ? "booking-email-error" : undefined}
                  onChange={(event) => setGuestEmail(event.target.value)}
                />
                {validationAttempted && !EMAIL_PATTERN.test(guestEmail.trim()) ? <FieldError id="booking-email-error">Enter a valid email address.</FieldError> : null}
              </Field>
              {bookingType.questions.map((question) => {
                const key = String(question.id ?? question.label);
                const safeKey = key.replace(/[^a-zA-Z0-9_-]/g, "-");
                const inputId = `booking-question-${safeKey}`;
                const invalid = validationAttempted && question.required && !answers[key]?.trim();
                return (
                  <Field key={key}>
                    <FieldLabel htmlFor={inputId}>{question.label}{question.required ? <RequiredMark /> : null}</FieldLabel>
                    {question.field_type === "textarea" ? (
                      <Textarea id={inputId} value={answers[key] ?? ""} maxLength={2000} aria-invalid={invalid} aria-describedby={invalid ? `${inputId}-error` : undefined} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))} />
                    ) : (
                      <Input id={inputId} value={answers[key] ?? ""} maxLength={2000} aria-invalid={invalid} aria-describedby={invalid ? `${inputId}-error` : undefined} onChange={(event) => setAnswers((current) => ({ ...current, [key]: event.target.value }))} />
                    )}
                    {invalid ? <FieldError id={`${inputId}-error`}>Answer this required question.</FieldError> : null}
                  </Field>
                );
              })}
              <Field>
                <FieldLabel htmlFor="booking-guest-note">Note</FieldLabel>
                <Textarea id="booking-guest-note" value={guestNote} maxLength={2000} rows={4} onChange={(event) => setGuestNote(event.target.value)} />
                <FieldDescription>Optional context for the meeting organizer.</FieldDescription>
              </Field>
            </FieldGroup>
            {submitError ? (
              <div role="alert" aria-live="polite" className="mt-4 rounded-[var(--radius-control)] border border-state-danger/40 bg-state-danger-muted px-3 py-3 text-sm text-copy-secondary">
                {submitError === "slot"
                  ? "That time is no longer available. Choose another time."
                  : submitError === "rate"
                    ? "Too many booking attempts were made. Please try again later."
                    : "The meeting could not be booked. Check your details and try again."}
              </div>
            ) : null}
            <Button type="submit" className="mt-4 w-full" disabled={!selectedSlot || submitting}>
              {submitting ? <><Loader2 className="animate-spin" />Booking…</> : "Book meeting"}
            </Button>
          </form>
        </div>
      </Card>
    </div>
  );
}
