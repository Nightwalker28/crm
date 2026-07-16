"use client";

import { useParams } from "next/navigation";

import OrderRecordFormPage from "@/components/orders/OrderRecordFormPage";

export default function EditOrderPage() {
  const params = useParams<{ orderId: string }>();
  return <OrderRecordFormPage mode="edit" orderId={params.orderId} />;
}
