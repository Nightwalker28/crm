import CatalogRecordDetailPage from "@/components/catalog/CatalogRecordDetailPage";

type Props = {
  params: Promise<{ serviceId: string }>;
};

export default async function CatalogServiceDetailPage({ params }: Props) {
  const { serviceId } = await params;
  return <CatalogRecordDetailPage kind="services" recordId={Number(serviceId)} />;
}
