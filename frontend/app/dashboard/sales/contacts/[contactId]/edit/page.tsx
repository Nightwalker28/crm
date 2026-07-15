"use client";

import { useParams } from "next/navigation";

import ContactRecordFormPage from "@/components/contacts/ContactRecordFormPage";

export default function EditContactPage() {
  const params = useParams<{ contactId: string }>();
  return <ContactRecordFormPage mode="edit" contactId={params.contactId} />;
}
