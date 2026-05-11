import { redirect } from "next/navigation";

export default function InvoiceGeneratorRedirectPage() {
  redirect("/dashboard/finance/pos");
}
