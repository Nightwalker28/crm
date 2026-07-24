import InsertionOrderRecordFormPage from "@/components/finance/InsertionOrderRecordFormPage";

export default async function EditInsertionOrderPage({
  params,
}: {
  params: Promise<{ ioId: string }>;
}) {
  const { ioId } = await params;
  return <InsertionOrderRecordFormPage mode="edit" ioId={ioId} />;
}
