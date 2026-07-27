"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { CalendarDays, Clock, ExternalLink, MapPin, UserRound } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useClientBooking, type ClientBooking } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

function bookingTitle(booking: ClientBooking) {
  return booking.booking_type_name || "Appointment";
}

function durationLabel(booking: ClientBooking) {
  const start = new Date(booking.start_at).getTime();
  const end = new Date(booking.end_at).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  return minutes ? `${minutes} minutes` : "Scheduled";
}

export default function ClientBookingDetailPage() {
  const params = useParams<{ bookingId: string }>();
  const bookingQuery = useClientBooking(params.bookingId);
  const booking = bookingQuery.data;

  return (
    <main className="min-h-screen bg-app text-copy-primary">
      <div className="mx-auto max-w-5xl px-4 py-6">
        <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line-default pb-4">
          <Link href="/client" className="font-lynk text-3xl text-copy-primary">Lynk</Link>
          <Button asChild variant="outline" size="sm">
            <Link href="/client/bookings">Bookings</Link>
          </Button>
        </header>

        {bookingQuery.isLoading ? (
          <div className="rounded-md border border-line-default bg-surface p-8 text-center text-sm text-copy-muted">Loading booking...</div>
        ) : bookingQuery.error || !booking ? (
          <div className="rounded-md border border-state-danger/40 bg-state-danger-muted p-5 text-sm text-state-danger">
            {bookingQuery.error instanceof Error ? bookingQuery.error.message : "Booking not found."}
          </div>
        ) : (
          <div className="grid gap-5">
            <section className="rounded-md border border-line-default bg-surface p-5">
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 text-sm text-copy-secondary">
                    <CalendarDays className="h-4 w-4" />
                    {booking.status}
                  </div>
                  <h1 className="mt-2 text-2xl font-semibold tracking-normal text-copy-primary">{bookingTitle(booking)}</h1>
                  <p className="mt-1 text-sm text-copy-secondary">{formatDateTime(booking.start_at)} / {booking.timezone}</p>
                </div>
                {booking.meeting_url ? (
                  <Button asChild>
                    <a href={booking.meeting_url} target="_blank" rel="noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Join
                    </a>
                  </Button>
                ) : null}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-3">
                <div className="rounded-md border border-line-default bg-app p-3">
                  <div className="flex items-center gap-2 text-xs uppercase text-copy-muted">
                    <Clock className="h-3.5 w-3.5" />
                    Duration
                  </div>
                  <div className="mt-1 text-sm text-copy-secondary">{durationLabel(booking)}</div>
                </div>
                <div className="rounded-md border border-line-default bg-app p-3">
                  <div className="flex items-center gap-2 text-xs uppercase text-copy-muted">
                    <UserRound className="h-3.5 w-3.5" />
                    Host
                  </div>
                  <div className="mt-1 text-sm text-copy-secondary">{booking.owner_name || "Team member"}</div>
                </div>
                <div className="rounded-md border border-line-default bg-app p-3">
                  <div className="flex items-center gap-2 text-xs uppercase text-copy-muted">
                    <MapPin className="h-3.5 w-3.5" />
                    Location
                  </div>
                  <div className="mt-1 text-sm text-copy-secondary">{booking.location || (booking.meeting_url ? "Online meeting" : "Not set")}</div>
                </div>
              </div>
            </section>

            {booking.guest_note ? (
              <section className="rounded-md border border-line-default bg-surface p-5">
                <h2 className="font-semibold text-copy-primary">Your note</h2>
                <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-copy-secondary">{booking.guest_note}</p>
              </section>
            ) : null}

            <section className="rounded-md border border-line-default bg-surface p-5">
              <h2 className="font-semibold text-copy-primary">Changes</h2>
              <p className="mt-2 text-sm leading-6 text-copy-secondary">
                Cancellation and rescheduling from the portal are not enabled for this appointment yet. Contact the team from Support or Messages if this time no longer works.
              </p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Button asChild variant="outline">
                  <Link href="/client/support">Support</Link>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/client/messages">Messages</Link>
                </Button>
              </div>
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
