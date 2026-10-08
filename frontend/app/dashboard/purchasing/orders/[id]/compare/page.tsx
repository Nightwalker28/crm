import { RfqComparePage } from "@/components/purchasing/RfqComparePage";

export default async function CompareRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <RfqComparePage orderId={Number(id)} />;
}
