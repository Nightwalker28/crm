import { ReturnDocumentPage } from "@/components/inventory/ReturnDocumentPage";

export default async function ReturnPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReturnDocumentPage returnId={Number(id)} />;
}
