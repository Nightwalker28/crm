"use client";

import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { ActionBar } from "@/components/ui/ActionBar";
import { PanelLoading } from "@/components/ui/PanelStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDateOnly, getUserTimezone } from "@/lib/datetime";
import { cn } from "@/lib/utils";

export type MonthGridEntryLayout = "cell" | "row";

type Scope = "grid" | "picker";

type MonthGridProps<T> = {
  /** Names the region — `"Task due date calendar"`. */
  label: string;
  /** What an entry is, for the day buttons' names — `{ one: "task", other: "tasks" }`. */
  entryNoun: { one: string; other: string };
  /** The month shown is the selected day's, so one value drives both. */
  selectedDay: Date;
  onSelectDay: (day: Date) => void;
  entries: T[];
  getKey: (entry: T) => string | number;
  /** The instant or `YYYY-MM-DD` an entry falls on. `null` leaves it off the grid. */
  getDate: (entry: T) => string | null | undefined;
  onOpenEntry: (entry: T) => void;
  /** What is inside the entry. The box, its hover and its focus are the grid's. */
  renderEntry: (entry: T, layout: MonthGridEntryLayout) => ReactNode;
  /** Said under the selected day's agenda when it has nothing. */
  emptyDayMessage: string;
  description?: ReactNode;
  /** A per-day control — *Create event on…*. Tabbable on the selected day only. */
  renderDayAction?: (day: Date, context: { label: string; tabIndex: 0 | -1 }) => ReactNode;
  isLoading?: boolean;
  /** Replaces the days and keeps the header — a failure or an empty list. */
  state?: ReactNode;
};

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const ENTRIES_PER_CELL = 3;

/** A calendar date's key, from its own fields — for the grid's days. */
function calendarKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

/** The day an entry falls on in the operator's timezone, which is the zone its time is printed in. */
function zonedKey(value: string | Date, timeZone: string) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const part = (type: string) => parts.find((candidate) => candidate.type === type)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

/** Today as a calendar date in the operator's timezone — the initial `selectedDay`. */
export function todayInUserTimezone() {
  const key = zonedKey(new Date(), getUserTimezone());
  if (!key) return new Date();
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

function addMonths(date: Date, months: number) {
  const lastDay = new Date(date.getFullYear(), date.getMonth() + months + 1, 0).getDate();
  return new Date(date.getFullYear(), date.getMonth() + months, Math.min(date.getDate(), lastDay));
}

/** The 42 days a month grid shows: the month, padded to whole weeks from Sunday. */
export function monthGridDays(month: Date) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  return Array.from({ length: 42 }, (_, index) => addDays(first, index - first.getDay()));
}

const monthFormat = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" });

/**
 * A month calendar (rebuild 5.7 ruling 5, design.md §7.14).
 *
 * `TasksCalendar` and the calendar page were the same grid written twice, each with its own
 * narrow day picker written twice more — and they disagreed on everything a grid decides:
 * today was a filled `bg-action-primary` circle on one and absent on the other, the selected
 * picker day borrowed the action tint, `+N more` was static text so a busy day's fourth entry
 * was unreachable, and the task picker started every month on Sunday's column whatever day
 * the 1st was. One contract:
 *
 * - **No container.** The call site's `ModuleTableShell` or `Card` is the box.
 * - **Days are keyed in the operator's timezone**, the zone the entry's time is printed in.
 * - **The grid when its own box is 42rem wide, the day picker and the day's agenda below that.**
 *   A container query, not a viewport breakpoint: at the same viewport the task list's shell
 *   is a full page wide and the calendar page's panel shares the row with a 20rem rail.
 * - **Today is weight and ink, the selected day is elevation.**
 * - **The day numerals are one tab stop**; arrows, `Home` / `End` and `PageUp` / `PageDown` move
 *   the selection, across months, and focus follows it.
 * - **Entries are the call site's**, inside a box that is the grid's.
 */
export function MonthGrid<T>({
  label,
  entryNoun,
  selectedDay,
  onSelectDay,
  entries,
  getKey,
  getDate,
  onOpenEntry,
  renderEntry,
  emptyDayMessage,
  description,
  renderDayAction,
  isLoading = false,
  state,
}: MonthGridProps<T>) {
  const rootRef = useRef<HTMLElement>(null);
  const pendingFocus = useRef<{ key: string; scope: Scope } | null>(null);
  const [openDay, setOpenDay] = useState<string | null>(null);

  const month = useMemo(() => new Date(selectedDay.getFullYear(), selectedDay.getMonth(), 1), [selectedDay]);
  const days = useMemo(() => monthGridDays(month), [month]);
  const selectedKey = calendarKey(selectedDay);
  const timeZone = getUserTimezone();
  const todayKey = zonedKey(new Date(), timeZone);

  const entriesByDay = useMemo(() => {
    const grouped = new Map<string, T[]>();
    for (const entry of entries) {
      const value = getDate(entry);
      const key = value ? zonedKey(value, timeZone) : null;
      if (!key) continue;
      const existing = grouped.get(key);
      if (existing) existing.push(entry);
      else grouped.set(key, [entry]);
    }
    return grouped;
  }, [entries, getDate, timeZone]);

  useEffect(() => {
    const pending = pendingFocus.current;
    if (!pending || !rootRef.current) return;
    const button = rootRef.current.querySelector<HTMLElement>(
      `[data-month-grid-scope="${pending.scope}"] [data-day="${pending.key}"]`,
    );
    if (!button) return;
    pendingFocus.current = null;
    button.focus();
  });

  function dayLabel(day: Date) {
    return formatDateOnly(calendarKey(day), { weekday: "long", month: "long" });
  }

  function dayName(day: Date) {
    const count = entriesByDay.get(calendarKey(day))?.length ?? 0;
    return `${dayLabel(day)}${count ? `, ${count} ${count === 1 ? entryNoun.one : entryNoun.other}` : ""}`;
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, day: Date, scope: Scope) {
    const moves: Record<string, () => Date> = {
      ArrowLeft: () => addDays(day, -1),
      ArrowRight: () => addDays(day, 1),
      ArrowUp: () => addDays(day, -7),
      ArrowDown: () => addDays(day, 7),
      Home: () => addDays(day, -day.getDay()),
      End: () => addDays(day, 6 - day.getDay()),
      PageUp: () => addMonths(day, -1),
      PageDown: () => addMonths(day, 1),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    const target = move();
    pendingFocus.current = { key: calendarKey(target), scope };
    onSelectDay(target);
  }

  function renderEntryButton(entry: T, layout: MonthGridEntryLayout) {
    return (
      <li key={getKey(entry)}>
        <button
          type="button"
          onClick={() => {
            // An entry opens a dialog, and a popover left open would sit under it.
            setOpenDay(null);
            onOpenEntry(entry);
          }}
          className={cn(
            "block w-full min-w-0 rounded-[var(--radius-control-sm)] text-left text-copy-primary transition-colors duration-150 hover:bg-surface-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus motion-reduce:transition-none",
            layout === "cell" ? "px-1.5 py-1 text-xs" : "px-2 py-2 text-sm",
          )}
        >
          {renderEntry(entry, layout)}
        </button>
      </li>
    );
  }

  const selectedEntries = entriesByDay.get(selectedKey) ?? [];
  const leadingBlanks = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  const monthDays = days.filter((day) => day.getMonth() === month.getMonth());

  return (
    <section ref={rootRef} data-slot="month-grid" aria-label={label} aria-busy={isLoading} className="@container/month-grid">
      <div className="border-b border-line-subtle px-4 py-3">
        <SectionHeading
          description={description}
          action={
            <ActionBar size="sm">
              <Button type="button" variant="outline" size="icon-sm" aria-label="Previous month" onClick={() => onSelectDay(addMonths(month, -1))}>
                <ChevronLeft />
              </Button>
              <Button type="button" variant="outline" onClick={() => onSelectDay(todayInUserTimezone())}>
                Today
              </Button>
              <Button type="button" variant="outline" size="icon-sm" aria-label="Next month" onClick={() => onSelectDay(addMonths(month, 1))}>
                <ChevronRight />
              </Button>
            </ActionBar>
          }
        >
          {monthFormat.format(month)}
        </SectionHeading>
      </div>

      {state ?? (
        <>
          <div data-month-grid-scope="grid" className="hidden @2xl/month-grid:block">
            <div className="grid grid-cols-7 border-b border-line-subtle" aria-hidden="true">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} className="px-2 py-2 text-2xs font-semibold text-copy-label">{weekday}</div>
              ))}
            </div>
            <div className="grid grid-cols-7">
              {days.map((day) => {
                const key = calendarKey(day);
                const dayEntries = entriesByDay.get(key) ?? [];
                const inMonth = day.getMonth() === month.getMonth();
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                const hidden = dayEntries.length - ENTRIES_PER_CELL;
                return (
                  <div
                    key={key}
                    className={cn(
                      "min-h-32 min-w-0 border-b border-r border-line-subtle p-1 [&:nth-child(7n)]:border-r-0 [&:nth-last-child(-n+7)]:border-b-0",
                      isSelected && "bg-surface-raised",
                    )}
                  >
                    <div className="flex items-center justify-between gap-1">
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        data-day={key}
                        tabIndex={isSelected ? 0 : -1}
                        aria-pressed={isSelected}
                        aria-current={isToday ? "date" : undefined}
                        aria-label={dayName(day)}
                        onClick={() => onSelectDay(day)}
                        onKeyDown={(event) => handleDayKeyDown(event, day, "grid")}
                        className={cn(
                          "text-xs tabular-nums",
                          isToday ? "font-semibold text-copy-primary" : "font-normal",
                          !isToday && (inMonth ? "text-copy-muted" : "text-copy-disabled"),
                        )}
                      >
                        {day.getDate()}
                      </Button>
                      {renderDayAction?.(day, { label: dayLabel(day), tabIndex: isSelected ? 0 : -1 })}
                    </div>
                    {isLoading ? (
                      inMonth ? <Skeleton className="mx-1.5 mt-2 h-3 w-3/4" /> : null
                    ) : dayEntries.length ? (
                      <ul className="mt-1 space-y-0.5">
                        {dayEntries.slice(0, ENTRIES_PER_CELL).map((entry) => renderEntryButton(entry, "cell"))}
                        {hidden > 0 ? (
                          <li>
                            <Popover open={openDay === key} onOpenChange={(open) => setOpenDay(open ? key : null)}>
                              <PopoverTrigger asChild>
                                <button
                                  type="button"
                                  aria-label={`Show all ${dayEntries.length} ${entryNoun.other} on ${dayLabel(day)}`}
                                  className="rounded-[var(--radius-control-sm)] px-1.5 py-0.5 text-2xs font-medium text-copy-label hover:text-copy-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                                >
                                  +{hidden} more
                                </button>
                              </PopoverTrigger>
                              <PopoverContent align="start" className="p-2">
                                <div className="px-2 pb-1 pt-1 text-xs font-semibold text-copy-label">{dayLabel(day)}</div>
                                <ul className="max-h-80 overflow-y-auto">
                                  {dayEntries.map((entry) => renderEntryButton(entry, "row"))}
                                </ul>
                              </PopoverContent>
                            </Popover>
                          </li>
                        ) : null}
                      </ul>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="@2xl/month-grid:hidden">
            <div data-month-grid-scope="picker" className="grid grid-cols-7 gap-1 p-3">
              {WEEKDAYS.map((weekday) => (
                <div key={weekday} aria-hidden="true" className="py-1 text-center text-2xs font-semibold text-copy-label">{weekday}</div>
              ))}
              {Array.from({ length: leadingBlanks }, (_, index) => <div key={`blank-${index}`} aria-hidden="true" />)}
              {monthDays.map((day) => {
                const key = calendarKey(day);
                const isSelected = key === selectedKey;
                const isToday = key === todayKey;
                const hasEntries = !isLoading && entriesByDay.has(key);
                return (
                  <Button
                    key={key}
                    type="button"
                    variant="ghost"
                    size="icon"
                    data-day={key}
                    tabIndex={isSelected ? 0 : -1}
                    aria-pressed={isSelected}
                    aria-current={isToday ? "date" : undefined}
                    aria-label={dayName(day)}
                    onClick={() => onSelectDay(day)}
                    onKeyDown={(event) => handleDayKeyDown(event, day, "picker")}
                    className={cn(
                      "relative w-full border tabular-nums",
                      isSelected ? "border-line-strong bg-surface-raised" : "border-transparent",
                      isToday ? "font-semibold text-copy-primary" : "font-normal text-copy-secondary",
                    )}
                  >
                    {day.getDate()}
                    {hasEntries ? <span aria-hidden="true" className="absolute bottom-1 left-1/2 size-1 -translate-x-1/2 rounded-full bg-copy-muted" /> : null}
                  </Button>
                );
              })}
            </div>
            <div className="border-t border-line-subtle px-3 py-3">
              <SectionHeading as="h3">{dayLabel(selectedDay)}</SectionHeading>
              {isLoading ? (
                <PanelLoading label={`Loading ${entryNoun.other}…`} />
              ) : selectedEntries.length ? (
                <ul className="mt-2 divide-y divide-line-subtle">
                  {selectedEntries.map((entry) => renderEntryButton(entry, "row"))}
                </ul>
              ) : (
                <p className="mt-2 text-sm text-copy-muted">{emptyDayMessage}</p>
              )}
            </div>
          </div>
        </>
      )}
    </section>
  );
}
