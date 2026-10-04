"use client";

import { Card } from "@/components/ui/Card";
import { Fact, FactList } from "@/components/ui/Fact";
import { Money } from "@/components/ui/Money";
import { PanelError, PanelLoading } from "@/components/ui/PanelStates";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { useOrderMargin, type OrderMarginLine } from "@/hooks/sales/useOrders";
import { isForbiddenError } from "@/lib/api";
import { formatQuantity as quantity } from "@/lib/quantity";


function percent(value: string | null) {
  return value == null ? "—" : `${Number(value).toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

/**
 * The order's Margin tab (12d-erp-costing.md §3.3): revenue, cost of goods and margin in the
 * base currency. What was delivered is at its actual cost; what is still to deliver, and
 * services and untracked products, are estimates and say so.
 */
export function OrderMarginPanel({ orderId }: { orderId: number }) {
  const query = useOrderMargin(orderId);
  const data = query.data;
  if (query.isLoading) return <Card className="p-6"><PanelLoading label="Loading margin…" /></Card>;
  if (query.error || !data) {
    return <Card className="p-6"><PanelError message={isForbiddenError(query.error) ? "You do not have access to stock valuation." : "Margin could not be loaded."} onRetry={() => void query.refetch()} /></Card>;
  }
  const currency = data.base_currency;
  return (
    <Card className="min-w-0 p-6">
      <SectionHeading description={data.rate_missing
        ? `This order is in ${data.currency}. Add its exchange rate to ${currency} on the edit page to see revenue and margin.`
        : `In ${currency}. Delivered goods at their actual cost${data.estimated ? "; the rest estimated at today's average cost" : ""}.`}>Margin</SectionHeading>
      <FactList className="mt-4 grid-cols-2 sm:grid-cols-4">
        <Fact label="Revenue">{data.revenue == null ? <span className="text-copy-muted">No exchange rate</span> : <Money amount={data.revenue} currency={currency} />}</Fact>
        <Fact label="Cost of goods"><Money amount={data.cost} currency={currency} /></Fact>
        <Fact label="Margin">{data.margin == null ? "—" : <Money amount={data.margin} currency={currency} />}</Fact>
        <Fact label="Margin %"><span className="tabular-nums">{percent(data.margin_percent)}</span></Fact>
      </FactList>
      {data.estimated && data.actual_margin != null ? (
        <FactList className="mt-4 grid-cols-2 sm:grid-cols-4">
          <Fact label="Delivered revenue"><Money amount={data.actual_revenue} currency={currency} /></Fact>
          <Fact label="Delivered cost"><Money amount={data.actual_cost} currency={currency} /></Fact>
          <Fact label="Delivered margin"><Money amount={data.actual_margin} currency={currency} /></Fact>
        </FactList>
      ) : null}
      {data.cost_missing ? <p className="mt-4 text-p-sm text-copy-secondary">Some lines have no cost, so their cost counts as zero and the margin is overstated.</p> : null}
      <div className="mt-6">
        <RecordTable<OrderMarginLine> variant="readOnly" shellVariant="nested" label="Margin by line" rows={data.lines} rowKey={(row) => row.order_line_id}
          emptyState={{ title: "No lines" }}
          columns={[
            { key: "name", label: "Item", size: "lg", render: (row) => row.name },
            { key: "quantity", label: "Ordered", align: "right", render: (row) => <span className="tabular-nums">{quantity(row.quantity)}</span> },
            { key: "delivered", label: "Delivered", align: "right", render: (row) => row.tracked ? <span className="tabular-nums">{quantity(row.delivered)}</span> : "—" },
            { key: "revenue", label: "Revenue", align: "right", render: (row) => <Money amount={row.revenue} currency={currency} /> },
            { key: "cost", label: "Cost", align: "right", render: (row) => <Money amount={row.cost} currency={currency} /> },
            { key: "margin", label: "Margin", align: "right", render: (row) => <Money amount={row.margin} currency={currency} /> },
            { key: "percent", label: "Margin %", align: "right", render: (row) => <span className="tabular-nums">{percent(row.margin_percent)}</span> },
            { key: "basis", label: "Basis", render: (row) => row.cost_missing
              ? <StatusValue status={{ label: "Cost missing", tone: "attention" }} />
              : row.estimated ? (row.tracked && Number(row.delivered) > 0 ? "Part estimated" : "Estimated") : "Actual" },
          ]} />
      </div>
    </Card>
  );
}
