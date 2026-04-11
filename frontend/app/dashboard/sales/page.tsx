"use client";

import GridLayout from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import "react-resizable/css/styles.css";

export default function SalesPage() {
  return (
    <div className="p-4">
      <h1 className="text-2xl font-bold mb-4">Sales Dashboard</h1>

      <GridLayout
        className="layout"
        gridConfig={{ cols: 12, rowHeight: 100 }}
        width={1200}
      >
        <div key="a" className="bg-slate-800 text-white rounded p-4">
          Widget A
        </div>

        <div key="b" className="bg-slate-700 text-white rounded p-4">
          Widget B
        </div>
      </GridLayout>
    </div>
  );
}