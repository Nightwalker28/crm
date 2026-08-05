"use client";

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Plus, Trash2, X } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { RequiredMark } from "@/components/ui/RequiredMark";
import TimezonePicker from "@/components/ui/TimezonePicker";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageToolbar } from "@/components/ui/PageToolbar";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetOverlay,
  SheetPortal,
  SheetTitle,
} from "@/components/ui/sheet";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useCalendarContext } from "@/hooks/useCalendar";
import { useConfirm } from "@/hooks/useConfirm";
import { useUnsavedChangesGuard } from "@/hooks/useUnsavedChangesGuard";
import { apiFetch } from "@/lib/api";
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
  if (!res.ok) throw new Error("Booking links could not be loaded.");
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

function publicUrl(slug: string) {
  if (typeof window === "undefined") return `/book/${slug}`;
  return `${window.location.origin}/book/${slug}`;
}

export default function CalendarBookingSettingsPage() {
  const queryClient = useQueryClient();
  const { confirm } = useConfirm();
  const contextQuery = useCalendarContext();
  const bookingTypesQuery = useQuery({ queryKey: ["calendar-booking-types"], queryFn: fetchBookingTypes });
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const [initialDraft, setInitialDraft] = useState<BookingDraft>(emptyDraft);
  const [editorOpen, setEditorOpen] = useState(false);
  const bookingTypes = bookingTypesQuery.data ?? [];
  const isEditing = Boolean(draft.id);
  const isDirty = useMemo(() => JSON.stringify(draft) !== JSON.stringify(initialDraft), [draft, initialDraft]);
  const ownerOptions = (contextQuery.data?.users ?? []).map((user) => ({
    value: String(user.id),
    label: user.name || user.email || `User ${user.id}`,
  }));

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
  useUnsavedChangesGuard(isDirty, saveMutation.isPending);

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
    <div className="flex flex-col gap-6">
      <PageToolbar context={isDirty ? "Unsaved booking-link changes" : undefined}>
          <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
            <Button asChild variant="outline"><Link href={SETTINGS_ROUTES.integrations}>Integrations</Link></Button>
            <Button type="button" onClick={() => void startNewBookingLink()}><Plus />New booking link</Button>
          </div>
      </PageToolbar>

      {bookingTypesQuery.isError ? (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-[var(--radius-card)] border border-state-danger/40 bg-state-danger-muted px-4 py-3 text-sm text-copy-primary">
          <span>Booking links could not be loaded.</span>
          <Button type="button" size="sm" variant="outline" onClick={() => void bookingTypesQuery.refetch()}>Try again</Button>
        </div>
      ) : null}

      <>
        <Sheet open={editorOpen} onOpenChange={handleEditorOpenChange}>
          <SheetPortal>
            <SheetOverlay className="fixed inset-0 z-40 bg-overlay" />
            <SheetContent
              side="right"
              className="z-50 flex h-full w-full max-w-[38rem] flex-col border-l border-line-default bg-surface-raised shadow-2xl outline-none"
            >
              <form
                className="flex min-h-0 flex-1 flex-col"
                onSubmit={(event) => {
                  event.preventDefault();
                  saveMutation.mutate(draft);
                }}
              >
                <SheetHeader className="flex items-start justify-between gap-4 border-b border-line-subtle px-5 py-4">
                  <div>
                    <SheetTitle className="text-lg font-semibold text-copy-primary">{isEditing ? "Edit booking link" : "Create booking link"}</SheetTitle>
                    <SheetDescription className="mt-1 text-sm text-copy-muted">Set the public schedule, meeting owner, and questions guests must answer.</SheetDescription>
                  </div>
                  <Button type="button" variant="ghost" size="icon-sm" aria-label="Close booking link editor" onClick={() => void closeEditor()}>
                    <X />
                  </Button>
                </SheetHeader>
                <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-copy-primary">Booking details</h3>
              <p className="mt-1 text-sm text-copy-muted">Public link identity, ownership, and availability.</p>
            </div>
            {isEditing ? <Button type="button" variant="ghost" size="sm" onClick={() => void startNewBookingLink()}>New</Button> : null}
          </div>

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
              <FieldDescription>The public URL will be /book/{draft.slug || "your-link"}.</FieldDescription>
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
              <FieldLabel>Duration</FieldLabel>
              <Input type="number" min="15" max="240" value={draft.duration_minutes} onChange={(event) => setDraft((current) => ({ ...current, duration_minutes: Number(event.target.value) }))} />
              {draft.duration_minutes < 15 || draft.duration_minutes > 240 ? <FieldError>Use a duration between 15 and 240 minutes.</FieldError> : null}
            </Field>
            <Field>
              <FieldLabel>Link availability</FieldLabel>
              <div className="grid grid-cols-2 gap-2" role="group" aria-label="Link availability">
                <Button
                  type="button"
                  variant={draft.enabled ? "secondary" : "outline"}
                  aria-pressed={draft.enabled}
                  onClick={() => setDraft((current) => ({ ...current, enabled: true }))}
                >
                  Enabled
                </Button>
                <Button
                  type="button"
                  variant={!draft.enabled ? "secondary" : "outline"}
                  aria-pressed={!draft.enabled}
                  onClick={() => setDraft((current) => ({ ...current, enabled: false }))}
                >
                  Disabled
                </Button>
              </div>
              <FieldDescription>Enabled links accept new public bookings. Existing calendar events remain when a link is disabled.</FieldDescription>
            </Field>
          </FieldGroup>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-copy-primary">Availability</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft((current) => ({
                  ...current,
                  availability: [...current.availability, { weekday: 0, start_time: "09:00", end_time: "17:00", sort_order: current.availability.length }],
                }))}
              >
                <Plus className="h-4 w-4" />
                Window
              </Button>
            </div>
            {draft.availability.map((window, index) => (
              <div key={`${window.weekday}-${index}`} className="grid gap-2 md:grid-cols-[1fr_1fr_1fr_auto]">
                <Select value={String(window.weekday)} onValueChange={(value) => updateAvailability(index, { weekday: Number(value) })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {WEEKDAYS.map((day, dayIndex) => <SelectItem key={day} value={String(dayIndex)}>{day}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input aria-label={`Start time for availability window ${index + 1}`} type="time" value={window.start_time.slice(0, 5)} onChange={(event) => updateAvailability(index, { start_time: event.target.value })} />
                <Input aria-label={`End time for availability window ${index + 1}`} type="time" value={window.end_time.slice(0, 5)} onChange={(event) => updateAvailability(index, { end_time: event.target.value })} />
                <Button aria-label={`Remove availability window ${index + 1}`} variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, availability: current.availability.filter((_, itemIndex) => itemIndex !== index) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-copy-primary">Questions</h3>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDraft((current) => ({
                  ...current,
                  questions: [...current.questions, { label: "", field_type: "text", required: false, sort_order: current.questions.length }],
                }))}
              >
                <Plus className="h-4 w-4" />
                Question
              </Button>
            </div>
            {draft.questions.map((question, index) => (
              <div key={`question-${index}`} className="grid gap-2 md:grid-cols-[minmax(0,1fr)_12rem_auto]">
                <Input aria-label={`Question ${index + 1} label`} value={question.label} placeholder="Question label" onChange={(event) => updateQuestion(index, { label: event.target.value })} />
                <div className="grid grid-cols-2 gap-2" role="group" aria-label={`Question ${index + 1} requirement`}>
                  <Button
                    type="button"
                    size="sm"
                    variant={question.required ? "secondary" : "outline"}
                    aria-pressed={question.required}
                    onClick={() => updateQuestion(index, { required: true })}
                  >
                    Required
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant={!question.required ? "secondary" : "outline"}
                    aria-pressed={!question.required}
                    onClick={() => updateQuestion(index, { required: false })}
                  >
                    Optional
                  </Button>
                </div>
                <Button aria-label={`Remove question ${index + 1}`} variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, questions: current.questions.filter((_, itemIndex) => itemIndex !== index) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

                </div>
                <SheetFooter className="flex flex-col gap-3 border-t border-line-subtle bg-surface px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                  <span className={`text-sm ${isDirty ? "text-state-warning" : "text-state-success"}`}>{isDirty ? "Unsaved changes" : "All changes saved"}</span>
                  <div className="flex gap-2">
                    <Button type="button" variant="outline" onClick={() => void closeEditor()} disabled={saveMutation.isPending}>Cancel</Button>
                    <Button
                      type="submit"
                      disabled={!isDirty || !draft.name.trim() || !draft.slug.trim() || !draft.availability.length || draft.duration_minutes < 15 || draft.duration_minutes > 240 || saveMutation.isPending}
                    >
                      {saveMutation.isPending ? "Saving..." : "Save booking link"}
                    </Button>
                  </div>
                </SheetFooter>
              </form>
            </SheetContent>
          </SheetPortal>
        </Sheet>

        <Card className="px-5 py-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-copy-primary">Booking links</h2>
              <p className="mt-1 text-sm text-copy-muted">Manage public scheduling links and their current availability.</p>
            </div>
            <Button type="button" size="sm" onClick={() => void startNewBookingLink()}><Plus />New link</Button>
          </div>
          <div className="mt-4 overflow-x-auto rounded-[var(--radius-card)] border border-line-default">
            <Table>
              <TableHeader>
                <TableHeaderRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Public URL</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableHeaderRow>
              </TableHeader>
              <TableBody>
                {bookingTypesQuery.isLoading ? (
                  <TableRow><TableCell colSpan={5} className="py-6 text-copy-muted">Loading booking links...</TableCell></TableRow>
                ) : bookingTypes.length ? bookingTypes.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell className="font-medium text-copy-primary">
                      <button
                        type="button"
                        className="rounded-sm text-left hover:underline focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={() => void editBookingType(item)}
                      >
                        {item.name}
                      </button>
                    </TableCell>
                    <TableCell className="text-copy-muted">{item.owner_name || `User ${item.owner_id}`}</TableCell>
                    <TableCell className="text-copy-muted">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 text-sm text-copy-secondary hover:text-copy-primary focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={(event) => {
                          event.stopPropagation();
                          void navigator.clipboard.writeText(publicUrl(item.slug));
                          toast.success("Booking link copied.");
                        }}
                      >
                        <Copy className="h-4 w-4" />
                        /book/{item.slug}
                      </button>
                    </TableCell>
                    <TableCell className={item.enabled ? "text-state-success" : "text-copy-muted"}>{item.enabled ? "Enabled" : "Disabled"}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="icon-sm">
                          <Link aria-label={`Open ${item.name} booking page`} href={`/book/${item.slug}`} target="_blank"><ExternalLink className="h-4 w-4" /></Link>
                        </Button>
                        <Button aria-label={`Disable ${item.name}`} variant="ghost" size="icon-sm" onClick={() => void confirmDisableBookingType(item)} disabled={!item.enabled || disableMutation.isPending}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5}><EmptyState title="No booking links yet" description="Create the first link to offer public meeting slots." /></TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </>
    </div>
  );
}
