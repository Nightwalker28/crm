"use client";

export default function FinancePage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Finance Dashboard</h1>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded bg-slate-800 p-4 text-white">
          Widget A
        </div>

        <div className="rounded bg-slate-700 p-4 text-white">
          Widget B
        </div>
      </div>
    </div>
  );
}
