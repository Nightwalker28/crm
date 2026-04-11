"use client";

import { useState } from "react";
import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import Image from "next/image";
import { FileText } from "lucide-react";

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
}: {
  order: InsertionOrder;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
            {order.campaign_name}
          </h3>

          <div className="flex items-center gap-3 text-xs text-zinc-400">
            <div className="flex items-center gap-1.5">
              {order.photo_url ? (
                <Image
                  src={order.photo_url}
                  alt={order.user_name}
                  width={20}
                  height={20}
                  className="rounded-full object-cover"
                />
              ) : (
                <div className="w-5 h-5 bg-zinc-800 rounded-full flex items-center justify-center border border-zinc-700">
                  <span className="text-[9px] font-medium text-zinc-300">
                    {getUserInitials(order.user_name)}
                  </span>
                </div>
              )}
              <span className="text-zinc-300">{order.user_name}</span>
            </div>
          </div>
        </div>

        {/* Right meta */}
        <div className="flex flex-col items-end gap-1">
          <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200">
            <span className="text-[9px] font-medium text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
              {getFileExtension(order.campaign_name)}
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