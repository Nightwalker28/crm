"use client";

import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import { RecordTable, type RecordTableColumn } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { TextLink } from "@/components/ui/TextLink";
import { usePurchasingActions, useRfqComparison, type RfqComparison } from "@/hooks/purchasing/usePurchasing";
import { useAccessibleModules } from "@/hooks/useAccessibleModules";
import { useConfirm } from "@/hooks/useConfirm";
import { isForbiddenError } from "@/lib/api";
import { formatDateOnly } from "@/lib/datetime";
import { formatQuantity as quantity } from "@/lib/quantity";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getPurchaseOrderStatus } from "@/lib/statusStyles";

type Vendor = RfqComparison["vendors"][number];
type Item = RfqComparison["items"][number];

const isOpen = (vendor: Vendor) => vendor.status === "draft" || vendor.status === "sent";

/**
 * Every vendor asked for the same request, side by side (13c §3.8; Odoo's purchase agreement
 * comparison, ERPNext's supplier quotation comparison). Per item, each vendor's unit cost after
 * discount with the lowest marked; per vendor, the total and expected date. *Place this one*
 * orders it and cancels the others.
 */
export function RfqComparePage({ orderId }: { orderId: number }) {
  const router = useRouter();
  const { confirm } = useConfirm();
  const { modules } = useAccessibleModules();
  const canPlace = Boolean(modules.find((module) => module.name === "purchase_orders")?.actions?.can_edit);
  const query = useRfqComparison(orderId);
  const mutations = usePurchasingActions();
  const data = query.data;
  const vendors = data?.vendors ?? [];

  async function place(vendor: Vendor) {
    const others = vendors.filter((row) => row.order_id !== vendor.order_id && isOpen(row));
    if (!(await confirm({
      title: `Place ${vendor.number} with ${vendor.vendor_name ?? "this vendor"}?`,
      description: `It becomes a purchase order and counts as incoming stock.${others.length ? ` ${others.map((row) => row.number).join(", ")} will be cancelled.` : ""}`,
      confirmLabel: "Place order",
    }))) return;
    try {
      await mutations.placeOrder(vendor.order_id);
      toast.success(`${vendor.number} placed.`);
      router.push(`${DASHBOARD_ROUTES.purchaseOrders}/${vendor.order_id}`);
    } catch (failure) { toast.error(failure instanceof Error ? failure.message : "The order could not be placed."); }
  }

  const itemColumns: RecordTableColumn<Item>[] = [
    { key: "item", label: "Item", size: "lg", render: (row) => row.name },
    ...vendors.map((vendor): RecordTableColumn<Item> => ({
      key: `vendor-${vendor.order_id}`,
      label: vendor.vendor_name ?? vendor.number,
      size: "md",
      align: "right",
      render: (row) => {
        const offer = row.offers.find((item) => item.order_id === vendor.order_id);
        if (!offer || offer.unit_cost == null) return <span className="text-copy-muted">Not quoted</span>;
        const lowest = row.lowest_unit_cost != null && Number(offer.unit_cost) === Number(row.lowest_unit_cost) && vendors.filter(isOpen).length > 1;
        return (
          <span className="flex flex-col items-end tabular-nums">
            <span className={lowest ? "font-semibold text-copy-primary" : undefined}><Money amount={offer.unit_cost} currency={vendor.currency} />{lowest ? " · lowest" : ""}</span>
            <span className="text-p-xs text-copy-muted">{quantity(offer.quantity)} for <Money amount={offer.line_total} currency={vendor.currency} /></span>
          </span>
        );
      },
    })),
  ];

  return (
    <PageShell
      variant="document"
      title="Compare requests for quotation"
      description="The same request, asked of each vendor. Enter the prices each vendor sends back on their request, then place the best one."
      backHref={`${DASHBOARD_ROUTES.purchaseOrders}/${orderId}`}
      isLoading={query.isLoading}
      isPermissionDenied={isForbiddenError(query.error)}
      hasError={Boolean(query.error) && !isForbiddenError(query.error)}
      onRetry={() => void query.refetch()}
    >
      <section className="flex flex-col gap-3">
        <SectionHeading>Vendors</SectionHeading>
        <RecordTable<Vendor>
          variant="readOnly"
          label="Vendors asked"
          rows={vendors}
          rowKey={(row) => row.order_id}
          emptyState={{ title: "No requests" }}
          columns={[
            { key: "number", label: "Request", size: "sm", rendersLink: true, render: (row) => <TextLink href={`${DASHBOARD_ROUTES.purchaseOrders}/${row.order_id}`}>{row.number}</TextLink> },
            { key: "vendor", label: "Vendor", size: "lg", render: (row) => row.vendor_name ?? "—" },
            { key: "status", label: "Status", size: "sm", render: (row) => <StatusValue status={getPurchaseOrderStatus(row.status)} /> },
            { key: "expected", label: "Expected", size: "sm", render: (row) => (row.expected_date ? formatDateOnly(row.expected_date) : "—") },
            { key: "total", label: "Total", size: "sm", align: "right", render: (row) => (
              <span className={row.is_lowest ? "font-semibold text-copy-primary tabular-nums" : "tabular-nums"}><Money amount={row.subtotal} currency={row.currency} />{row.is_lowest ? " · lowest" : ""}</span>
            ) },
            { key: "place", label: <span className="sr-only">Place</span>, size: "sm", interactive: true, render: (row) => (canPlace && isOpen(row)
              ? <Button size="sm" variant={row.is_lowest ? "default" : "outline"} onClick={() => void place(row)} disabled={mutations.isSaving}>Place this one</Button>
              : null) },
          ]}
        />
      </section>
      <section className="flex flex-col gap-3">
        <SectionHeading description="Unit cost after each line's discount. Totals compare only within one currency.">Items</SectionHeading>
        <RecordTable<Item>
          variant="readOnly"
          label="Items by vendor"
          rows={data?.items ?? []}
          rowKey={(row) => `${row.kind}-${row.item_id}`}
          emptyState={{ title: "No items" }}
          columns={itemColumns}
        />
      </section>
    </PageShell>
  );
}
