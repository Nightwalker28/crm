import BookingForm from "@/components/calendar/BookingForm";

export default async function PublicBookingPage({ params }: { params: Promise<{ bookingSlug: string }> }) {
  const { bookingSlug } = await params;

  return (
    <main className="min-h-screen bg-neutral-950 px-4 py-8 text-neutral-200 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <BookingForm slug={bookingSlug} />
      </div>
    </main>
  );
}
