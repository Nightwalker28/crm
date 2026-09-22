"use client";

import { useState } from "react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { Money } from "@/components/ui/Money";
import { PageShell } from "@/components/ui/PageShell";
import SearchBar from "@/components/ui/SearchBar";
import { StatusValue } from "@/components/ui/StatusValue";
import { useClientCatalog, type ClientCatalogItem } from "@/hooks/useClientPortal";
import { getCatalogStockStatus, getGenericStatus } from "@/lib/statusStyles";

/**
 * A service is always orderable, so it has no stock state to report — `getGenericStatus`
 * carries the flat "Available" without claiming a stock tone it does not have.
 */
function availability(item: ClientCatalogItem) {
  return item.kind === "service" ? getGenericStatus("available") : getCatalogStockStatus(item.availability_status);
}

export default function ClientCatalogPage() {
  const [search, setSearch] = useState("");
  const catalogQuery = useClientCatalog(search);
  const items = catalogQuery.data?.results ?? [];

  return (
    <PageShell
      title="Products and services"
      actions={<SearchBar value={search} onChange={setSearch} placeholder="Search catalog" className="w-full sm:w-80" />}
      isLoading={catalogQuery.isLoading}
      hasError={Boolean(catalogQuery.error)}
      backHref="/client"
      backLabel="Return to the portal"
      onRetry={() => catalogQuery.refetch()}
    >
      {items.length === 0 ? (
        <EmptyState
          title={search ? "No catalog items match that search" : "No catalog items published"}
          description={
            search
              ? "Try a shorter search, or clear it to see everything published to your account."
              : "Products and services published to your account will appear here, at your account's pricing."
          }
        />
      ) : (
        // A row over a card (§1.5). This was a three-column card grid, which spent a box per
        // product to say what a row says in one line.
        <Card className="p-0">
          <RowList label="Catalog" inset>
            {items.map((item) => (
              <ListRow
                key={`${item.kind}-${item.id}`}
                title={item.name}
                href={`/client/catalog/${item.kind}/${item.id}`}
                meta={<span className="capitalize">{item.kind}</span>}
                trailing={
                  <span className="flex items-center gap-3">
                    <StatusValue status={availability(item)} />
                    <Money amount={item.resolved_unit_price} currency={item.currency} className="font-medium text-copy-primary" />
                  </span>
                }
              >
                {item.description ?? null}
              </ListRow>
            ))}
          </RowList>
        </Card>
      )}
    </PageShell>
  );
}
