import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function InvoicesNotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Invoice"
      backHref="/dashboard/finance/invoices"
      backLabel="Back to invoices"
    />
  );
}
