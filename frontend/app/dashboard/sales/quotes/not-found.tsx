import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function QuotesNotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Quote"
      backHref="/dashboard/sales/quotes"
      backLabel="Back to quotes"
    />
  );
}
