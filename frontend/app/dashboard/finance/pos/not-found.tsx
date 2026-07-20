import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function NotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Invoice"
      backHref="/dashboard/finance/pos"
      backLabel="Back to invoices"
    />
  );
}
