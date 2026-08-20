"use client";

import { KeyRound, Users } from "lucide-react";

import { RecordTable } from "@/components/ui/RecordTable";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { ClientAccount, ClientAccountStatus, ClientPortalSortState } from "@/hooks/useClientPortal";
import { formatDateTime } from "@/lib/datetime";

/**
 * The client accounts table (rebuild.md 5.5). See `ClientPagesTable` for why it is a
 * component and not a column array inside the page.
 *
 * The status cell is `interactive`, so a click on the select never opens the row — the one
 * thing a cell holding its own control has to declare to `RecordTable`.
 */
export function ClientAccountsTable({
  accounts,
  customerLabel,
  sort,
  onSortChange,
  isLoading,
  isRefreshing,
  hasError,
  onRetry,
  onStatusChange,
  isUpdatingStatus,
  onRegenerateSetupLink,
  isRegeneratingSetupLink,
}: {
  accounts: ClientAccount[];
  customerLabel: (account: ClientAccount) => string;
  sort: ClientPortalSortState;
  onSortChange: (column: string) => void;
  isLoading: boolean;
  isRefreshing: boolean;
  hasError: boolean;
  onRetry: () => void;
  onStatusChange: (accountId: number, status: ClientAccountStatus) => void;
  isUpdatingStatus: boolean;
  onRegenerateSetupLink: (accountId: number) => void;
  isRegeneratingSetupLink: boolean;
}) {
  return (
    <RecordTable
      label="Client accounts"
      shellVariant="nested"
      columns={[
        {
          key: "email",
          label: "Email",
          size: "lg",
          sortable: true,
          render: (account) => <span className="font-medium text-copy-primary">{account.email}</span>,
        },
        { key: "customer", label: "Customer", render: (account) => <span className="text-copy-secondary">{customerLabel(account)}</span> },
        {
          key: "status",
          label: "Status",
          sortable: true,
          interactive: true,
          render: (account) => (
            <Select
              value={account.status}
              onValueChange={(value) => onStatusChange(account.id, value as ClientAccountStatus)}
              disabled={isUpdatingStatus}
            >
              <SelectTrigger size="sm" className="w-[132px] capitalize" aria-label={`Access status for ${account.email}`}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pending">Pending</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          ),
        },
        {
          key: "last_login_at",
          label: "Last login",
          sortable: true,
          render: (account) => (
            <span className="text-copy-muted">{account.last_login_at ? formatDateTime(account.last_login_at) : "Never"}</span>
          ),
        },
        {
          key: "setup_token_expires_at",
          label: "Setup expires",
          sortable: true,
          render: (account) => (
            <span className="text-copy-muted">
              {account.setup_token_expires_at ? formatDateTime(account.setup_token_expires_at) : "Not set"}
            </span>
          ),
        },
        {
          key: "updated_at",
          label: "Updated",
          sortable: true,
          render: (account) => <span className="text-copy-muted">{formatDateTime(account.updated_at)}</span>,
        },
      ]}
      rows={accounts}
      rowKey={(account) => account.id}
      sort={sort ? { column: sort.key, direction: sort.direction } : null}
      onSortChange={(next) => onSortChange(next.column)}
      isLoading={isLoading}
      isRefreshing={isRefreshing}
      hasError={hasError}
      onRetry={onRetry}
      emptyState={{
        icon: Users,
        title: "No client accounts yet",
        description: "Create a setup link above to provision authenticated client access.",
      }}
      rowActions={(account) => (
        <div className="flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onRegenerateSetupLink(account.id)}
            disabled={isRegeneratingSetupLink || account.status === "inactive"}
          >
            <KeyRound />
            Setup link
          </Button>
        </div>
      )}
    />
  );
}
