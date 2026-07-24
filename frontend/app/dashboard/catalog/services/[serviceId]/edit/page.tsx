import CatalogRecordFormPage from "@/components/catalog/CatalogRecordFormPage";

type Props = {
  params: Promise<{ serviceId: string }>;
};

export default async function EditCatalogServicePage({ params }: Props) {
  const { serviceId } = await params;
  return <CatalogRecordFormPage kind="services" mode="edit" recordId={Number(serviceId)} />;
}
