import { RouteLoadingState } from "@/components/ui/RouteStates";

// Deliberately not the splash. This boundary sits inside the dashboard shell,
// so a full-screen overlay here blanked the sidebar and header on every
// navigation and cost the operator their sense of place. A page-shaped skeleton
// keeps the shell standing.
export default function DashboardLoading() {
  return <RouteLoadingState label="dashboard" />;
}
