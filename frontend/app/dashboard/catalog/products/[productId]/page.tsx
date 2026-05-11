import CatalogRecordDetailPage from "@/components/catalog/CatalogRecordDetailPage";

type Props = {
  params: Promise<{ productId: string }>;
};

export default async function CatalogProductDetailPage({ params }: Props) {
  const { productId } = await params;
  return <CatalogRecordDetailPage kind="products" recordId={Number(productId)} />;
}
