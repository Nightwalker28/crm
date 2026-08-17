import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function LeadsNotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Lead"
      backHref="/dashboard/sales/leads"
      backLabel="Back to leads"
    />
  );
}
