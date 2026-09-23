"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { FormSection } from "@/components/forms/RecordFormLayout";
import { FormFooter } from "@/components/ui/ActionBar";
import { SegmentedBoolean } from "@/components/ui/SegmentedControl";
import { Button } from "@/components/ui/button";
import { EditorPanel } from "@/components/ui/EditorPanel";
import { RecordTable } from "@/components/ui/RecordTable";
import { RequiredMark } from "@/components/ui/RequiredMark";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import TimezonePicker from "@/components/ui/TimezonePicker";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/ui/PageShell";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useCalendarContext } from "@/hooks/useCalendar";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { ApiError, apiFetch, isForbiddenError } from "@/lib/api";
import { SETTINGS_ROUTES } from "@/lib/routes";

type Availability = {
  weekday: number;
  start_time: string;
  end_time: string;
  sort_order: number;
};

type Question = {
  id?: number | null;
  label: string;
  field_type: "text" | "textarea";
  required: boolean;
  sort_order: number;
};

type BookingType = {
  id: number;
  owner_id: number;
  owner_name?: string | null;
  owner_handle: string;
  name: string;
  slug: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  timezone: string;
  enabled: boolean;
  availability: Availability[];
  questions: Question[];
};

type BookingDraft = {
  id?: number;
  name: string;
  slug: string;
  owner_id: string;
  duration_minutes: number;
  buffer_before_minutes: number;
  buffer_after_minutes: number;
  timezone: string;
  enabled: boolean;
  availability: Availability[];
  questions: Question[];
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const emptyDraft: BookingDraft = {
  name: "",
  slug: "",
  owner_id: "",
  duration_minutes: 30,
  buffer_before_minutes: 0,
  buffer_after_minutes: 0,
  timezone: "UTC",
  enabled: true,
  availability: [{ weekday: 0, start_time: "09:00", end_time: "17:00", sort_order: 0 }],
  questions: [],
};

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 120);
}

async function readJson(res: Response) {
  return res.json().catch(() => null);
}

async function fetchBookingTypes() {
  const res = await apiFetch("/calendar/booking-types");
  const body = await readJson(res);
  if (!res.ok) throw new ApiError(res.status, "Booking links could not be loaded.");
  return (body?.results ?? []) as BookingType[];
}

async function saveBookingType(payload: BookingDraft) {
  const body = {
    name: payload.name.trim(),
    slug: payload.slug.trim(),
    owner_id: payload.owner_id ? Number(payload.owner_id) : null,
    duration_minutes: payload.duration_minutes,
    buffer_before_minutes: payload.buffer_before_minutes,
    buffer_after_minutes: payload.buffer_after_minutes,
    timezone: payload.timezone.trim() || "UTC",
    enabled: payload.enabled,
    availability: payload.availability,
    questions: payload.questions,
  };
  const res = await apiFetch(payload.id ? `/calendar/booking-types/${payload.id}` : "/calendar/booking-types", {
    method: payload.id ? "PUT" : "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const responseBody = await readJson(res);
  if (!res.ok) throw new Error("The booking link could not be saved. Check the fields and try again.");
  return responseBody as BookingType;
}

async function disableBookingType(id: number) {
  const res = await apiFetch(`/calendar/booking-types/${id}`, { method: "DELETE" });
  if (!res.ok) {
    throw new Error("The booking link could not be disabled.");
  }
}

type BookingHandle = { booking_handle: string; canonical_prefix: string };

async function fetchBookingHandle() {
  const res = await apiFetch("/calendar/booking-types/handle/current");
  const body = await readJson(res);
  if (!res.ok) throw new Error("Your booking handle could not be loaded.");
  return body as BookingHandle;
}

async function saveBookingHandle(bookingHandle: string) {
  const res = await apiFetch("/calendar/booking-types/handle/current", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ booking_handle: bookingHandle.trim().toLowerCase() }),
  });
  const body = await readJson(res);
  if (!res.ok) {
    throw new Error(typeof body?.detail === "string" ? body.detail : "Your booking handle could not be saved.");
  }
  return body as BookingHandle;
}

function publicUrl(ownerHandle: string, slug: string) {
  const path = `/book/${ownerHandle}/${slug}`;
  if (typeof window === "undefined") return path;
  return `${window.location.origin}${path}`;
}

export default function CalendarBookingSettingsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const contextQuery = useCalendarContext();
  const bookingTypesQuery = useQuery({ queryKey: ["calendar-booking-types"], queryFn: fetchBookingTypes });
  const bookingHandleQuery = useQuery({ queryKey: ["calendar-booking-handle"], queryFn: fetchBookingHandle });
  const [bookingHandleOverride, setBookingHandleOverride] = useState<string | null>(null);
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [initialDraft, setInitialDraft] = useState<BookingDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const bookingTypes = bookingTypesQuery.data ?? [];
  const bookingHandleDraft = bookingHandleOverride ?? bookingHandleQuery.data?.booking_handle ?? "";
  const isEditing = Boolean(draft.id);
  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initialDraft), [draft, initialDraft]);
  const isDurationOutOfRange = draft.duration_minutes < 15 || draft.duration_minutes > 240;
  // The same set the submit button used to spell inline, named once so the field-level error
  // and the disabled commit cannot disagree about what "valid" is.
  const isDraftValid = Boolean(draft.name.trim())
    && Boolean(draft.slug.trim())
    && draft.availability.length > 0
    && !isDurationOutOfRange;
  const isHandleDirty = Boolean(
    bookingHandleDraft
    && bookingHandleDraft !== bookingHandleQuery.data?.booking_handle,
  );
  const ownerOptions = (contextQuery.data?.users ?? []).map((user) => ({
    value: String(user.id),
    label: user.name || user.email || `User ${user.id}`,
    bookingHandle: user.booking_handle,
  }));
  const selectedOwnerHandle = ownerOptions.find((option) => option.value === draft.owner_id)?.bookingHandle
    || bookingHandleQuery.data?.booking_handle
    || "your-handle";

  const bookingHandleMutation = useMutation({
    mutationFn: saveBookingHandle,
    onSuccess: async (saved) => {
      queryClient.setQueryData(["calendar-booking-handle"], saved);
      setBookingHandleOverride(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["calendar-context"] }),
        queryClient.invalidateQueries({ queryKey: ["calendar-booking-types"] }),
      ]);
      toast.success("Booking handle saved.");
    },
  });

  const saveMutation = useMutation({
    mutationFn: saveBookingType,
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-booking-types"] });
      setDraft(emptyDraft);
      setInitialDraft(emptyDraft);
      setEditorOpen(false);
      toast.success(`Booking link ${saved.name} saved.`);
    },
    onError: () => toast.error("The booking link could not be saved. Check the fields and try again."),
  });

  const disableMutation = useMutation({
    mutationFn: disableBookingType,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-booking-types"] });
      toast.success("Booking link disabled.");
    },
    onError: () => toast.error("The booking link could not be disabled."),
  });
  useUnsavedChangesGuard(isDirty || isHandleDirty, saveMutation.isPending || bookingHandleMutation.isPending);

  async function editBookingType(item: BookingType) {
    if (isDirty && item.id !== draft.id) {
      const confirmed = await confirmDiscardDraft("Switching booking links will discard the changes in this form.");
      if (!confirmed) return;
    }
    const nextDraft: BookingDraft = {
      id: item.id,
      name: item.name,
      slug: item.slug,
      owner_id: String(item.owner_id),
      duration_minutes: item.duration_minutes,
      buffer_before_minutes: item.buffer_before_minutes,
      buffer_after_minutes: item.buffer_after_minutes,
      timezone: item.timezone,
      enabled: item.enabled,
      availability: item.availability.length ? item.availability : emptyDraft.availability,
      questions: item.questions,
    };
    setDraft(nextDraft);
    setInitialDraft(nextDraft);
    setEditorOpen(true);
  }

  function resetDraft() {
    setDraft(emptyDraft);
    setInitialDraft(emptyDraft);
  }

  async function confirmDiscardDraft(description: string) {
    if (!isDirty) return true;
    return confirm({
      title: "Discard unsaved changes?",
      description,
      confirmLabel: "Discard changes",
      variant: "destructive",
    });
  }

  async function startNewBookingLink() {
    if (!await confirmDiscardDraft("Starting a new booking link will discard the changes in this form.")) return;
    resetDraft();
    setEditorOpen(true);
  }

  async function closeEditor() {
    if (!await confirmDiscardDraft("Closing this editor will discard the changes in this form.")) return;
    resetDraft();
    setEditorOpen(false);
  }

  function handleEditorOpenChange(open: boolean) {
    if (open) {
      setEditorOpen(true);
      return;
    }
    void closeEditor();
  }

  async function confirmDisableBookingType(item: BookingType) {
    const confirmed = await confirm({
      title: "Disable booking link?",
      description: `"${item.name}" will stop accepting new bookings. Existing calendar events are not removed.`,
      confirmLabel: "Disable link",
      variant: "destructive",
    });
    if (confirmed) disableMutation.mutate(item.id);
  }

  function updateAvailability(index: number, patch: Partial<Availability>) {
    setDraft((current) => ({
      ...current,
      availability: current.availability.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  function updateQuestion(index: number, patch: Partial<Question>) {
    setDraft((current) => ({
      ...current,
      questions: current.questions.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item),
    }));
  }

  return (
    <PageShell
      variant="settings"
      title="Booking links"
      description="Public scheduling links and booking availability."
      context={isDirty || isHandleDirty ? "Unsaved booking-link changes" : undefined}
      isPermissionDenied={isForbiddenError(bookingTypesQuery.error)}
      backHref={SETTINGS_ROUTES.root}
      backLabel="Back to settings"
      actions={<Button type="button" onClick={() => void startNewBookingLink()}><Plus />Create booking link</Button>}
    >
      {/* A configuration record (R1): one field, but saving it moves every canonical public
          link this workspace has handed out, so it commits deliberately. */}
      <FormSection
        title="Public booking handle"
        description="Every canonical booking link begins with this handle. Changing it moves all of them."
      >
        <Field className="max-w-xl">
          <FieldLabel htmlFor="booking-owner-handle">Handle</FieldLabel>
          <Input
            id="booking-owner-handle"
            value={bookingHandleDraft}
            disabled={bookingHandleQuery.isLoading || bookingHandleMutation.isPending}
            onChange={(event) => setBookingHandleOverride(slugify(event.target.value).slice(0, 60))}
            aria-describedby="booking-owner-handle-description"
          />
          <FieldDescription id="booking-owner-handle-description">
            Links begin with /book/{bookingHandleDraft || "your-handle"}. Three characters or more.
          </FieldDescription>
          {bookingHandleQuery.isError ? <FieldError>Your booking handle could not be loaded.</FieldError> : null}
          {bookingHandleMutation.error ? <FieldError>{bookingHandleMutation.error.message}</FieldError> : null}
        </Field>
        <FormFooter
          className="mt-5"
          status={isHandleDirty ? "Unsaved changes" : "No unsaved changes"}
        >
          <Button
            type="button"
            variant="outline"
            disabled={bookingHandleMutation.isPending || !isHandleDirty || bookingHandleDraft.length < 3}
            onClick={() => bookingHandleMutation.mutate(bookingHandleDraft)}
          >
            {bookingHandleMutation.isPending ? "Saving\u2026" : "Save handle"}
          </Button>
        </FormFooter>
      </FormSection>

      <FormSection title="Booking links" description="Manage public scheduling links and their current availability.">
        <RecordTable
          label="Booking links"
          columns={[
            {
              key: "name",
              label: "Name",
              size: "lg",
              render: (item) => <span className="font-medium text-copy-primary">{item.name}</span>,
            },
            { key: "owner", label: "Owner", render: (item) => <span className="text-copy-muted">{item.owner_name || `User ${item.owner_id}`}</span> },
            {
              key: "url",
              label: "Public URL",
              size: "lg",
              interactive: true,
              render: (item) => (
                <button
                  type="button"
                  className="inline-flex items-center gap-2 rounded-[var(--radius-control-sm)] text-sm text-copy-secondary hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  onClick={() => {
                    void navigator.clipboard.writeText(publicUrl(item.owner_handle, item.slug));
                    toast.success("Booking link copied.");
                  }}
                >
                  <Copy className="size-4" />
                  /book/{item.owner_handle}/{item.slug}
                </button>
              ),
            },
            {
              key: "status",
              label: "Status",
              size: "sm",
              render: (item) => (
                <StatusValue status={{ tone: item.enabled ? "success" : "neutral", label: item.enabled ? "Enabled" : "Disabled" }} />
              ),
            },
          ]}
          rows={bookingTypes}
          rowKey={(item) => item.id}
          shellVariant="nested"
          onOpenRow={(item) => void editBookingType(item)}
          rowLabel={(item) => `Edit booking link ${item.name}`}
          isLoading={bookingTypesQuery.isLoading}
          isRefreshing={bookingTypesQuery.isFetching && !bookingTypesQuery.isLoading}
          hasError={Boolean(bookingTypesQuery.error)}
          onRetry={() => void bookingTypesQuery.refetch()}
          errorState={{ title: "Booking links could not be loaded" }}
          emptyState={{
            icon: CalendarDays,
            title: "No booking links yet",
            description: "Create the first link to offer public meeting slots.",
            action: <Button type="button" onClick={() => void startNewBookingLink()}><Plus />Create booking link</Button>,
          }}
          rowActions={(item) => (
            <div className="flex justify-end gap-2">
              <Button asChild variant="ghost" size="icon-sm">
                <Link aria-label={`Open ${item.name} booking page`} href={`/book/${item.owner_handle}/${item.slug}`} target="_blank"><ExternalLink /></Link>
              </Button>
              <Button aria-label={`Disable ${item.name}`} variant="ghost" size="icon-sm" onClick={() => void confirmDisableBookingType(item)} disabled={!item.enabled || disableMutation.isPending}>
                <Trash2 />
              </Button>
            </div>
          )}
        />
      </FormSection>

      <EditorPanel
        open={editorOpen}
        onOpenChange={handleEditorOpenChange}
        title={isEditing ? "Edit booking link" : "Create booking link"}
        description="Set the public schedule, meeting owner, and questions guests must answer."
        closeLabel="Close booking link editor"
        size="wide"
        onSubmit={() => saveMutation.mutate(draft)}
        status={isDirty ? "Unsaved changes" : isEditing ? "All changes saved" : "Complete the required fields to create this booking link."}
        footer={(
          <>
            <Button type="button" variant="outline" onClick={() => handleEditorOpenChange(false)} disabled={saveMutation.isPending}>Cancel</Button>
            <Button type="submit" disabled={!isDirty || !isDraftValid || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving\u2026" : "Save booking link"}
            </Button>
          </>
        )}
      >
        <div className="flex flex-col gap-6">
          <div>
            <SectionHeading as="h3" className="mb-4">Details</SectionHeading>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="booking-link-name">Name <RequiredMark /></FieldLabel>
                <Input
                  id="booking-link-name"
                  value={draft.name}
                  onChange={(event) => setDraft((current) => ({
                    ...current,
                    name: event.target.value,
                    slug: current.slug || slugify(event.target.value),
                  }))}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="booking-link-slug">Slug <RequiredMark /></FieldLabel>
                <Input id="booking-link-slug" value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: slugify(event.target.value) }))} />
                <FieldDescription>The public URL will be /book/{selectedOwnerHandle}/{draft.slug || "your-link"}.</FieldDescription>
              </Field>
              <Field>
                <FieldLabel>Owner</FieldLabel>
                <Select value={draft.owner_id || undefined} onValueChange={(value) => setDraft((current) => ({ ...current, owner_id: value }))}>
                  <SelectTrigger><SelectValue placeholder="Current user" /></SelectTrigger>
                  <SelectContent>
                    {ownerOptions.map((option) => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field>
                <FieldLabel>Timezone <RequiredMark /></FieldLabel>
                <TimezonePicker value={draft.timezone} onChange={(timezone) => setDraft((current) => ({ ...current, timezone }))} />
              </Field>
              <Field>
                <FieldLabel htmlFor="booking-link-duration">Duration (minutes)</FieldLabel>
                <Input id="booking-link-duration" type="number" min="15" max="240" value={draft.duration_minutes} onChange={(event) => setDraft((current) => ({ ...current, duration_minutes: Number(event.target.value) }))} />
                {isDurationOutOfRange ? <FieldError>Use a duration between 15 and 240 minutes.</FieldError> : null}
              </Field>
              <Field>
                <FieldLabel>Link availability</FieldLabel>
                <SegmentedBoolean
                  aria-label="Link availability"
                  value={draft.enabled}
                  onValueChange={(enabled) => setDraft((current) => ({ ...current, enabled }))}
                  trueLabel="Enabled"
                  falseLabel="Disabled"
                />
                <FieldDescription>Enabled links accept new public bookings. Existing calendar events remain when a link is disabled.</FieldDescription>
              </Field>
            </FieldGroup>
          </div>

          <div>
            <SectionHeading
              as="h3"
              className="mb-3"
              action={(
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft((current) => ({
                    ...current,
                    availability: [...current.availability, { weekday: 0, start_time: "09:00", end_time: "17:00", sort_order: current.availability.length }],
                  }))}
                >
                  <Plus />
                  Window
                </Button>
              )}
            >
              Availability
            </SectionHeading>
            <div className="flex flex-col gap-2">
              {draft.availability.map((window, index) => (
                <div key={`${window.weekday}-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                  <Select value={String(window.weekday)} onValueChange={(value) => updateAvailability(index, { weekday: Number(value) })}>
                    <SelectTrigger aria-label={`Weekday for availability window ${index + 1}`}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {WEEKDAYS.map((day, dayIndex) => <SelectItem key={day} value={String(dayIndex)}>{day}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <Input aria-label={`Start time for availability window ${index + 1}`} type="time" value={window.start_time.slice(0, 5)} onChange={(event) => updateAvailability(index, { start_time: event.target.value })} />
                  <Input aria-label={`End time for availability window ${index + 1}`} type="time" value={window.end_time.slice(0, 5)} onChange={(event) => updateAvailability(index, { end_time: event.target.value })} />
                  <Button type="button" aria-label={`Remove availability window ${index + 1}`} variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, availability: current.availability.filter((_, itemIndex) => itemIndex !== index) }))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {draft.availability.length === 0 ? (
                <p className="text-p-sm text-copy-muted">A link needs at least one availability window before it can be saved.</p>
              ) : null}
            </div>
          </div>

          <div>
            <SectionHeading
              as="h3"
              className="mb-3"
              action={(
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setDraft((current) => ({
                    ...current,
                    questions: [...current.questions, { label: "", field_type: "text", required: false, sort_order: current.questions.length }],
                  }))}
                >
                  <Plus />
                  Question
                </Button>
              )}
            >
              Questions
            </SectionHeading>
            <div className="flex flex-col gap-2">
              {draft.questions.map((question, index) => (
                <div key={`question-${index}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
                  <Input aria-label={`Question ${index + 1} label`} value={question.label} placeholder="Question label" onChange={(event) => updateQuestion(index, { label: event.target.value })} />
                  <SegmentedBoolean
                    aria-label={`Question ${index + 1} requirement`}
                    value={question.required}
                    onValueChange={(required) => updateQuestion(index, { required })}
                    trueLabel="Required"
                    falseLabel="Optional"
                  />
                  <Button type="button" aria-label={`Remove question ${index + 1}`} variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, questions: current.questions.filter((_, itemIndex) => itemIndex !== index) }))}>
                    <Trash2 />
                  </Button>
                </div>
              ))}
              {draft.questions.length === 0 ? (
                <p className="text-p-sm text-copy-muted">Guests are asked only for a name and an email address.</p>
              ) : null}
            </div>
          </div>
        </div>
      </EditorPanel>
    </PageShell>
  );
}
