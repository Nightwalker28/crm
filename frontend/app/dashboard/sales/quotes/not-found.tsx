import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function NotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Quote"
      backHref="/dashboard/sales/quotes"
      backLabel="Back to quotes"
    />
  );
}
