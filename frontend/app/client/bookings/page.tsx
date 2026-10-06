"use client";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PageShell } from "@/components/ui/PageShell";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientBookings, type ClientBooking } from "@/hooks/useClientPortal";
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

export default function ClientBookingsPage() {
  const bookingsQuery = useClientBookings();
  const bookings = bookingsQuery.data?.results ?? [];

  return (
    <PageShell
      title="Upcoming appointments"
      isLoading={bookingsQuery.isLoading}
      hasError={Boolean(bookingsQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => bookingsQuery.refetch()}
    >
      {bookings.length === 0 ? (
        <EmptyState
          title="No appointments booked"
          description="Appointments scheduled with your account will appear here, with the time and duration."
        />
      ) : (
        <Card className="p-0">
          <RowList label="Appointments" inset>
            {bookings.map((booking) => (
              <ListRow
                key={booking.id}
                title={bookingTitle(booking)}
                href={`/client/bookings/${booking.id}`}
                meta={`${formatDateTime(booking.start_at)} · ${booking.timezone} · ${durationLabel(booking)}`}
                trailing={<StatusValue status={getGenericStatus(booking.status)} />}
              />
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
