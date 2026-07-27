"use client";

import Link from "next/link";
import { ArrowRight, CalendarDays, Clock } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClientBookings, type ClientBooking } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function bookingTitle(booking: ClientBooking) {
  return booking.booking_type_name || "Appointment";
}

function durationLabel(booking: ClientBooking) {
  const start = new Date(booking.start_at).getTime();
  const end = new Date(booking.end_at).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  return minutes ? `${minutes} min` : "Scheduled";
}

export default function ClientBookingsPage() {
  const bookingsQuery = useClientBookings();
  const bookings = bookingsQuery.data?.results ?? [];

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-6xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client">Overview</Link>
          </Button>
        </header>

        <section className="mb-5">
          <div className="flex items-center gap-2 text-sm text-copy-secondary">
            <CalendarDays className="h-4 w-4" />
            Client bookings
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">Upcoming appointments</h1>
        </section>

        {bookingsQuery.isLoading ? (
          <div className="rounded-md border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading bookings...</div>
        ) : bookingsQuery.error ? (
          <div className="rounded-md border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {bookingsQuery.error instanceof Error ? bookingsQuery.error.message : "Failed to load bookings."}
          </div>
        ) : bookings.length === 0 ? (
          <div className="rounded-md border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">No upcoming appointments are assigned to your portal account.</div>
        ) : (
          <div className="grid gap-3">
            {bookings.map((booking) => (
              <Link key={booking.id} href={`/client/bookings/${booking.id}`} className="group rounded-md border border-line-default bg-surface p-4 transition-colors hover:border-line-strong hover:bg-surface-raised">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs uppercase text-copy-muted">{booking.status}</div>
                    <h2 className="mt-1 truncate font-semibold text-copy-primary">{bookingTitle(booking)}</h2>
                    <p className="mt-1 text-xs text-copy-muted">{formatDateTime(booking.start_at)} / {booking.timezone}</p>
                  </div>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2 text-sm text-copy-secondary">
                      <Clock className="h-4 w-4 text-copy-muted" />
                      {durationLabel(booking)}
                    </div>
                    <ArrowRight className="h-4 w-4 text-copy-muted transition-transform group-hover:translate-x-0.5" />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </main>
  );
}
