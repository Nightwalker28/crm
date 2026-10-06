import { RouteNotFoundState } from "@/components/ui/RouteStates";

export default function ContactsNotFound() {
  return (
    <RouteNotFoundState
      recordLabel="Contact"
      backHref="/dashboard/sales/contacts"
      backLabel="Back to contacts"
    />
  );
}
