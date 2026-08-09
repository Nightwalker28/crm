import BookingForm from "@/components/calendar/BookingForm";

export function PublicBookingPage({
  slug,
  ownerHandle,
}: {
  slug: string;
  ownerHandle?: string;
}) {
  return (
    <main className="min-h-screen bg-app px-4 py-6 text-copy-primary sm:px-6 sm:py-8 lg:px-8">
      <div className="mx-auto max-w-5xl">
        <header className="mb-6 border-b border-line-subtle pb-4">
          <div className="font-lynk text-3xl text-copy-primary">Lynk</div>
        </header>
        <BookingForm ownerHandle={ownerHandle} slug={slug} />
        <footer className="mt-6 border-t border-line-subtle pt-4 text-center text-xs leading-5 text-copy-muted">
          Booking details are shared only with the meeting organizer.
        </footer>
      </div>
    </main>
  );
}
