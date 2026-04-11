import type { InsertionOrder } from "@/hooks/finance/useInsertionOrders";
import { FileText } from "lucide-react";
import InsertionOrderCard from "./insertOrderCard";

type InsertionOrdersListProps = {
  orders: InsertionOrder[];
  isLoading: boolean;
};


export default function InsertionOrdersList({
  orders,
  isLoading,
}: InsertionOrdersListProps) {
  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="animate-pulse bg-zinc-900 border border-zinc-800 rounded-lg p-3.5"
          >
            <div className="flex gap-3">
              <div className="w-10 h-10 bg-zinc-800 rounded-lg" />
              <div className="flex-1 space-y-2">
                <div className="h-3.5 w-2/3 bg-zinc-800 rounded" />
                <div className="h-3 w-1/2 bg-zinc-800 rounded" />
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (!orders.length) {
    return (
      <div className="bg-zinc-900 border border-dashed border-zinc-700 rounded-xl p-12 text-center">
        <FileText className="mx-auto mb-4 text-zinc-600" size={48} />
        <p className="text-zinc-400 text-sm">
          No insertion orders yet. Upload one to get started.
        </p>
      </div>
    );
  }

  return (
    <div className="relative">
      <style jsx>{`
        .scrollable-container::-webkit-scrollbar {
          width: 8px;
        }
        .scrollable-container::-webkit-scrollbar-track {
          background: transparent;
        }
        .scrollable-container::-webkit-scrollbar-thumb {
          background: #52525b;
          border-radius: 4px;
        }
        .scrollable-container::-webkit-scrollbar-thumb:hover {
          background: #71717a;
        }
      `}</style>
      
      <div 
        className="scrollable-container flex flex-col gap-2 overflow-y-auto max-h-[calc(100vh-20rem)] p-3 bg-zinc-950/30 rounded-lg border border-zinc-900"
        style={{
          scrollbarWidth: 'thin',
          scrollbarColor: '#52525b transparent'
        }}
      >
        {orders.map((order, idx) => (
          <InsertionOrderCard
            key={order.user_id + "-" + order.campaign_name + "-" + idx}
            order={order}
          />
        ))}
      </div>
      
      {orders.length > 3 && (
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-linear-to-t from-zinc-950 to-transparent pointer-events-none rounded-b-lg" />
      )}
    </div>
  );
}