"use client";

import { useParams } from "next/navigation";

import { PaymentRecordPage } from "@/components/finance/payments/PaymentRecordPage";

export default function PaymentPage() {
  const params = useParams<{ paymentId: string }>();
  return <PaymentRecordPage paymentId={/^\d+$/.test(params.paymentId) ? Number(params.paymentId) : null} />;
}
