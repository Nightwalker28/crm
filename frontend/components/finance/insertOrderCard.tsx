"use client";

import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import Image from "next/image";
import { FileText, Pencil, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";

function getFileExtension(fileName: string): string {
  return fileName.split(".").pop()?.toUpperCase() || "FILE";
}

function getUserInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function formatDate(dateString: string): string {
  if (!dateString) return "";
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return dateString;
  return date.toLocaleDateString();
}

export default function InsertionOrderCard({
  order,
  onEdit,
  onDelete,
}: {
  order: InsertionOrder;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const userName = order.user_name || "Unassigned";
  const displayTitle = order.customer_name || order.counterparty_reference || order.io_number;
  const reference = order.counterparty_reference || order.external_reference || order.file_name;
  const status = order.status.charAt(0).toUpperCase() + order.status.slice(1);
  const amount =
    typeof order.total_amount === "number"
      ? new Intl.NumberFormat(undefined, {
          style: "currency",
          currency: order.currency || "USD",
          maximumFractionDigits: 2,
        }).format(order.total_amount)
      : null;

  return (
    <div
      className="group relative bg-zinc-900/50 border border-zinc-800 rounded-lg p-3.5
        hover:bg-zinc-900 hover:border-zinc-700 transition-all duration-200"
    >
      <div className="flex items-center gap-3">
        {/* Icon */}
        <div className="shrink-0 w-10 h-10 bg-zinc-800 rounded-lg flex items-center justify-center border border-zinc-700">
          <FileText className="text-blue-400" size={20} />
        </div>

        {/* Main content */}
        <div className="flex-1 min-w-0">
          <h3 className="text-sm font-medium text-zinc-100 mb-1 truncate">
            {displayTitle}
          </h3>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5">
              {order.photo_url ? (
                <Image
                  src={order.photo_url}
                  alt={userName}
                  width={20}
                  height={20}
                  className="rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-700">
                  <span className="text-[9px] font-medium text-zinc-300">
                    {getUserInitials(userName)}
                  </span>
                </div>
              )}
              <span className="text-zinc-300">{userName}</span>
            </div>
            <span className="rounded-full border border-zinc-700 bg-zinc-800 px-2 py-0.5 text-[11px] text-zinc-300">
              {status}
            </span>
            <span className="text-zinc-500">{order.io_number}</span>
            {reference ? <span className="truncate text-zinc-500">{reference}</span> : null}
            {amount ? <span className="text-zinc-300">{amount}</span> : null}
          </div>
        </div>

        {/* Right meta */}
        <div className="flex flex-col items-end gap-2">
          <div className="flex items-center gap-1 opacity-0 transition-opacity duration-200 group-hover:opacity-100">
            <Button type="button" variant="ghost" size="icon-sm" onClick={onEdit} aria-label="Edit insertion order">
              <Pencil size={14} />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onDelete} aria-label="Delete insertion order">
              <Trash2 size={14} />
            </Button>
          </div>
          <div>
            <span className="text-[9px] font-medium text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
              {getFileExtension(order.file_name || order.external_reference || order.io_number)}
            </span>
          </div>

          <span className="text-xs text-zinc-500">
            {formatDate(order.updated_at)}
          </span>
        </div>
      </div>
    </div>
  );
}
