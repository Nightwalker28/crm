"use client";

import { useParams } from "next/navigation";
import { ExternalLink } from "lucide-react";

import { RecordWorkspace } from "@/components/recordWorkspace/RecordWorkspace";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Fact, FactList } from "@/components/ui/Fact";
import { PanelHeader } from "@/components/ui/PanelStates";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientBooking, type ClientBooking } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";
import { getGenericStatus } from "@/lib/statusStyles";

function bookingTitle(booking: ClientBooking) {
  return booking.booking_type_name || "Appointment";
}

function durationLabel(booking: ClientBooking) {
  const start = new Date(booking.start_at).getTime();
  const end = new Date(booking.end_at).getTime();
  const minutes = Math.max(0, Math.round((end - start) / 60000));
  return minutes ? `${minutes} min` : "Scheduled";
}

export default function ClientBookingDetailPage() {
  const params = useParams();
  const bookingId = String(params.bookingId ?? "");
  const bookingQuery = useClientBooking(bookingId);
  const booking = bookingQuery.data;

  return (
    // Archetype 2, read-only (§4.7): no `spine`. Rescheduling from the portal is not
    // enabled, so nothing on this record edits in place.
    <RecordWorkspace
      title={booking ? bookingTitle(booking) : "Appointment"}
      description="Review the appointment's time, host and location."
      backHref="/client/bookings"
      backLabel="Bookings"
      isLoading={bookingQuery.isLoading}
      hasError={Boolean(bookingQuery.error) || (!bookingQuery.isLoading && !booking)}
      onRetry={() => void bookingQuery.refetch()}
      status={booking ? <StatusValue status={getGenericStatus(booking.status)} context="record" /> : null}
      subtitle={
        booking ? (
          <>
            <span>{formatDateTime(booking.start_at)}</span>
            <span>{booking.timezone}</span>
          </>
        ) : null
      }
      actions={
        booking?.meeting_url ? (
          <Button asChild>
            <a href={booking.meeting_url} target="_blank" rel="noreferrer">
              <ExternalLink />
              Join
            </a>
          </Button>
        ) : null
      }
      details={
        booking ? (
          <div className="flex min-w-0 flex-col gap-6">
            <Card className="p-6">
              <FactList>
                <Fact label="Duration">{durationLabel(booking)}</Fact>
                <Fact label="Host">{booking.owner_name || <EmptyValue context="field" />}</Fact>
                <Fact label="Location">
                  {booking.location || (booking.meeting_url ? "Online meeting" : <EmptyValue context="field" />)}
                </Fact>
              </FactList>
            </Card>

            {booking.guest_note ? (
              <Card className="flex min-w-0 flex-col gap-4 p-6">
                <PanelHeader title="Your note" />
                <p className="whitespace-pre-wrap text-p-sm text-copy-secondary">{booking.guest_note}</p>
              </Card>
            ) : null}

            <Card className="flex min-w-0 flex-col gap-4 p-6">
              <PanelHeader
                title="Need to change this?"
                description="Rescheduling and cancelling from the portal are not available yet — reply to your booking confirmation email and the team will move it for you."
              />
            </Card>
          </div>
        ) : null
      }
    />
  );
}
