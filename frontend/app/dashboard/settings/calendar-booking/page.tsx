"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Copy, ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch, SwitchThumb } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableHeaderRow, TableRow } from "@/components/ui/Table";
import { useCalendarContext } from "@/hooks/useCalendar";
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
  if (!res.ok) throw new Error(body?.detail ?? `Failed with ${res.status}`);
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
  if (!res.ok) throw new Error(responseBody?.detail ?? `Failed with ${res.status}`);
  return responseBody as BookingType;
}

async function disableBookingType(id: number) {
  const res = await apiFetch(`/calendar/booking-types/${id}`, { method: "DELETE" });
  if (!res.ok) {
    const body = await readJson(res);
    throw new Error(body?.detail ?? `Failed with ${res.status}`);
  }
}

function publicUrl(slug: string) {
  if (typeof window === "undefined") return `/book/${slug}`;
  return `${window.location.origin}/book/${slug}`;
}

export default function CalendarBookingSettingsPage() {
  const queryClient = useQueryClient();
  const contextQuery = useCalendarContext();
  const bookingTypesQuery = useQuery({ queryKey: ["calendar-booking-types"], queryFn: fetchBookingTypes });
  const [draft, setDraft] = useState<BookingDraft>(emptyDraft);
  const bookingTypes = bookingTypesQuery.data ?? [];
  const isEditing = Boolean(draft.id);
  const ownerOptions = (contextQuery.data?.users ?? []).map((user) => ({
    value: String(user.id),
    label: user.name || user.email || `User ${user.id}`,
  }));

  const saveMutation = useMutation({
    mutationFn: saveBookingType,
    onSuccess: async (saved) => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-booking-types"] });
      setDraft(emptyDraft);
      toast.success(`Booking link ${saved.name} saved.`);
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to save booking link."),
  });

  const disableMutation = useMutation({
    mutationFn: disableBookingType,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ["calendar-booking-types"] });
      toast.success("Booking link disabled.");
    },
    onError: (error) => toast.error(error instanceof Error ? error.message : "Failed to disable booking link."),
  });

  function editBookingType(item: BookingType) {
    setDraft({
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
    });
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
    <div className="flex flex-col gap-6 text-neutral-200">
      <PageHeader
        title="Booking Links"
        description="Create public meeting links that offer available calendar slots and write confirmed bookings back to the CRM calendar."
        actions={<Button asChild variant="outline"><Link href={SETTINGS_ROUTES.integrations}>Integrations</Link></Button>}
      />

      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card className="px-5 py-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-100">{isEditing ? "Edit booking link" : "Create booking link"}</h2>
            </div>
            {isEditing ? <Button variant="ghost" size="sm" onClick={() => setDraft(emptyDraft)}>New</Button> : null}
          </div>

          <FieldGroup className="grid gap-4 md:grid-cols-2">
            <Field>
              <FieldLabel>Name</FieldLabel>
              <Input
                value={draft.name}
                onChange={(event) => setDraft((current) => ({
                  ...current,
                  name: event.target.value,
                  slug: current.slug || slugify(event.target.value),
                }))}
              />
            </Field>
            <Field>
              <FieldLabel>Slug</FieldLabel>
              <Input value={draft.slug} onChange={(event) => setDraft((current) => ({ ...current, slug: slugify(event.target.value) }))} />
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
              <FieldLabel>Timezone</FieldLabel>
              <Input value={draft.timezone} onChange={(event) => setDraft((current) => ({ ...current, timezone: event.target.value }))} />
            </Field>
            <Field>
              <FieldLabel>Duration</FieldLabel>
              <Input type="number" min="15" max="240" value={draft.duration_minutes} onChange={(event) => setDraft((current) => ({ ...current, duration_minutes: Number(event.target.value) }))} />
            </Field>
            <Field>
              <FieldLabel>Enabled</FieldLabel>
              <div className="flex h-10 items-center">
                <Switch
                  checked={draft.enabled}
                  onCheckedChange={(checked) => setDraft((current) => ({ ...current, enabled: checked }))}
                  className="relative h-6 w-11 shrink-0 rounded-full border border-neutral-700 bg-neutral-800 data-[state=checked]:bg-emerald-600"
                >
                  <SwitchThumb className="block h-5 w-5 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" />
                </Switch>
              </div>
            </Field>
          </FieldGroup>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-100">Availability</h3>
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
                <Input type="time" value={window.start_time.slice(0, 5)} onChange={(event) => updateAvailability(index, { start_time: event.target.value })} />
                <Input type="time" value={window.end_time.slice(0, 5)} onChange={(event) => updateAvailability(index, { end_time: event.target.value })} />
                <Button variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, availability: current.availability.filter((_, itemIndex) => itemIndex !== index) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-neutral-100">Questions</h3>
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
              <div key={`question-${index}`} className="grid gap-2 md:grid-cols-[1fr_auto_auto]">
                <Input value={question.label} placeholder="Question label" onChange={(event) => updateQuestion(index, { label: event.target.value })} />
                <div className="flex items-center gap-2 rounded-md border border-neutral-800 px-3 py-2 text-sm text-neutral-300">
                  Required
                  <Switch
                    checked={question.required}
                    onCheckedChange={(checked) => updateQuestion(index, { required: checked })}
                    className="relative h-6 w-11 shrink-0 rounded-full border border-neutral-700 bg-neutral-800 data-[state=checked]:bg-emerald-600"
                  >
                    <SwitchThumb className="block h-5 w-5 rounded-full bg-white shadow-sm data-[state=checked]:translate-x-5" />
                  </Switch>
                </div>
                <Button variant="ghost" size="icon-sm" onClick={() => setDraft((current) => ({ ...current, questions: current.questions.filter((_, itemIndex) => itemIndex !== index) }))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDraft(emptyDraft)}>Reset</Button>
            <Button onClick={() => saveMutation.mutate(draft)} disabled={!draft.name.trim() || !draft.slug.trim() || !draft.availability.length || saveMutation.isPending}>
              {saveMutation.isPending ? "Saving..." : "Save"}
            </Button>
          </div>
        </Card>

        <Card className="px-5 py-5">
          <h2 className="text-lg font-semibold text-neutral-100">Booking links</h2>
          <div className="mt-4 overflow-hidden rounded-lg border border-neutral-800">
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
                  <TableRow><TableCell colSpan={5} className="py-6 text-neutral-500">Loading booking links...</TableCell></TableRow>
                ) : bookingTypes.length ? bookingTypes.map((item) => (
                  <TableRow key={item.id} className="cursor-pointer" onClick={() => editBookingType(item)}>
                    <TableCell className="font-medium text-neutral-100">{item.name}</TableCell>
                    <TableCell className="text-neutral-400">{item.owner_name || `User ${item.owner_id}`}</TableCell>
                    <TableCell className="text-neutral-400">
                      <button
                        type="button"
                        className="inline-flex items-center gap-2 text-sm text-neutral-300 hover:text-white"
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
                    <TableCell className={item.enabled ? "text-emerald-300" : "text-neutral-500"}>{item.enabled ? "Enabled" : "Disabled"}</TableCell>
                    <TableCell className="text-right" onClick={(event) => event.stopPropagation()}>
                      <div className="flex justify-end gap-2">
                        <Button asChild variant="ghost" size="icon-sm">
                          <Link href={`/book/${item.slug}`} target="_blank"><ExternalLink className="h-4 w-4" /></Link>
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => disableMutation.mutate(item.id)} disabled={!item.enabled || disableMutation.isPending}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow><TableCell colSpan={5} className="py-8 text-neutral-500">No booking links yet.</TableCell></TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </Card>
      </div>
    </div>
  );
}
