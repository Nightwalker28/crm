import { notFound } from "next/navigation";

import { PublicBookingPage } from "@/components/calendar/PublicBookingPage";

export default async function PublicBookingRoute({
  params,
}: {
  params: Promise<{ bookingPath: string[] }>;
}) {
  const { bookingPath } = await params;
  if (bookingPath.length === 1) {
    return <PublicBookingPage slug={bookingPath[0]} />;
  }
  if (bookingPath.length === 2) {
    return <PublicBookingPage ownerHandle={bookingPath[0]} slug={bookingPath[1]} />;
  }
  notFound();
}
