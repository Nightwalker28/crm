import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function OrdersNotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Order"
      backHref="/dashboard/sales/orders"
      backLabel="Back to orders"
    />
  );
}
