"use client";

import { ReceiptText } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyValue } from "@/components/ui/EmptyValue";
import { Fact, FactList } from "@/components/ui/Fact";
import { Money } from "@/components/ui/Money";
import { RecordTable } from "@/components/ui/RecordTable";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatusValue } from "@/components/ui/StatusValue";
import { TextLink } from "@/components/ui/TextLink";
import { isForbiddenError } from "@/lib/api";
import { formatDateTime } from "@/lib/datetime";
import { DASHBOARD_ROUTES } from "@/lib/routes";
import { getOrderStatus, getQuoteStatus } from "@/lib/statusStyles";
import { useCatalogItemSales, type CatalogItemSalesLine, type CatalogKind } from "@/hooks/catalog/useCatalogRecords";

function documentHref(line: CatalogItemSalesLine) {
  return line.document_type === "quote" ? `${DASHBOARD_ROUTES.quotes}/${line.document_id}` : `${DASHBOARD_ROUTES.orders}/${line.document_id}`;
}

function formatQuantity(value: number | string, unit: string) {
  const quantity = Number(value);
  const figure = Number.isFinite(quantity) ? quantity.toLocaleString(undefined, { maximumFractionDigits: 4 }) : String(value);
  return unit === "unit" ? figure : `${figure} ${unit}`;
}

/**
 * The record's *Sales* tab: the quote and order lines picked from this item (Odoo's *Sold*
 * smart button, Dynamics' related quotes and orders; 12-erp-inventory.md §4.1).
 *
 * The endpoint only returns the document types the viewer can open, and says which, so the
 * figures never imply a quote or order the viewer was not shown.
 */
export function CatalogItemSalesPanel({ kind, itemId, unit }: { kind: CatalogKind; itemId: number; unit: string }) {
  const sales = useCatalogItemSales(kind, itemId);
  const data = sales.data;
  const noun = kind === "products" ? "product" : "service";

  return (
    <Card className="min-w-0 p-6">
      <SectionHeading description={`Quote and order lines picked from this ${noun}. Lines typed by hand are not counted.`}>
        Sales
      </SectionHeading>
      {data && (data.can_view_quotes || data.can_view_orders) ? (
        <FactList className="mt-4 grid-cols-2 md:grid-cols-3">
          {data.can_view_quotes ? <Fact label="Quote lines">{data.quote_line_count}</Fact> : null}
          {data.can_view_orders ? <Fact label="Order lines">{data.order_line_count}</Fact> : null}
          {data.can_view_orders ? (
            <Fact label="Ordered, excluding cancelled">
              <span className="tabular-nums">{formatQuantity(data.ordered_quantity, unit)}</span>
            </Fact>
          ) : null}
        </FactList>
      ) : null}
      <div className="mt-4">
        <RecordTable
          variant="readOnly"
          shellVariant="nested"
          label={`Sales of this ${noun}`}
          rows={data?.results ?? []}
          rowKey={(line) => `${line.document_type}-${line.document_id}-${line.document_number}-${line.quantity}`}
          isLoading={sales.isLoading}
          isPermissionDenied={isForbiddenError(sales.error)}
          hasError={Boolean(sales.error) && !isForbiddenError(sales.error)}
          onRetry={() => void sales.refetch()}
          errorState={{ title: "Sales could not be loaded" }}
          emptyState={
            data && !data.can_view_quotes && !data.can_view_orders
              ? { icon: ReceiptText, title: "No access to quotes or orders", description: "Ask an administrator for access to Quotes or Orders to see where this is sold." }
              : { icon: ReceiptText, title: `No quotes or orders use this ${noun} yet`, description: `Pick it from the catalog on a quote or order line and it appears here.` }
          }
          columns={[
            {
              key: "document",
              label: "Document",
              size: "md",
              render: (line) => (
                <>
                  <TextLink href={documentHref(line)}>{line.document_number}</TextLink>
                  <div className="mt-1 text-xs text-copy-muted">{line.document_type === "quote" ? "Quote" : "Order"}</div>
                </>
              ),
            },
            { key: "customer", label: "Customer", size: "md", render: (line) => line.customer_name ?? <EmptyValue /> },
            {
              key: "status",
              label: "Status",
              size: "sm",
              render: (line) => <StatusValue status={line.document_type === "quote" ? getQuoteStatus(line.status) : getOrderStatus(line.status)} />,
            },
            { key: "quantity", label: "Quantity", align: "right", size: "sm", render: (line) => <span className="tabular-nums">{formatQuantity(line.quantity, unit)}</span> },
            { key: "line_total", label: "Line total", align: "right", size: "sm", render: (line) => <Money amount={line.line_total} currency={line.currency} /> },
            { key: "date", label: "Created", size: "sm", render: (line) => (line.document_date ? formatDateTime(line.document_date, { hour: undefined, minute: undefined }) : <EmptyValue />) },
          ]}
        />
      </div>
    </Card>
  );
}
