import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function InvoicesNotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Invoice"
      backHref="/dashboard/finance/pos"
      backLabel="Back to invoices"
    />
  );
}
