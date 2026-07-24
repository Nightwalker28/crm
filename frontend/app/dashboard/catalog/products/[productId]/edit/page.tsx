import CatalogRecordFormPage from "@/components/catalog/CatalogRecordFormPage";

type Props = {
  params: Promise<{ productId: string }>;
};

export default async function EditCatalogProductPage({ params }: Props) {
  const { productId } = await params;
  return <CatalogRecordFormPage kind="products" mode="edit" recordId={Number(productId)} />;
}
