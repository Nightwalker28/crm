"use client";

import { LineTaxSelect, lineTaxValue, CUSTOM_TAX, type LineTaxChoice } from "@/components/finance/tax/TaxRateSelect";
import { LineNumberInput, type LineCellContext } from "@/components/transactions/LineItemsEditor";
import { useTaxRates, type TaxRate } from "@/hooks/finance/useTaxRates";
import { computeLine, unitsToNumber } from "@/lib/money";

/**
 * Purchase lines' tax (13d §3.1): POs, bills and vendor credits. Purchase prices are before
 * tax. *Automatic* lets the server pick: on a bill line from a PO, the PO line's tax; else the
 * item's purchase rate, then the company's default purchase rate.
 */
export type PurchaseLineTax = LineTaxChoice & {
  /** What *Automatic* resolves to for this line's preview (the PO line's or item's rate). */
  auto_rate_id?: number | null;
};

export function emptyPurchaseLineTax(): PurchaseLineTax {
  return { tax_rate_id: null, tax_manual: false, tax_amount: "0" };
}

export function purchaseLineTaxFrom(line: { tax_rate_id?: number | null; tax_manual?: boolean | null; tax_amount?: unknown }): PurchaseLineTax {
  return { tax_rate_id: line.tax_rate_id ?? null, tax_manual: Boolean(line.tax_manual), tax_amount: String(Number(line.tax_amount ?? 0)) };
}

export function purchaseLineTaxPayload(tax: PurchaseLineTax) {
  return { tax_rate_id: tax.tax_rate_id, tax_manual: tax.tax_manual, tax_amount: tax.tax_manual ? tax.tax_amount || "0" : "0" };
}

function previewRate(tax: PurchaseLineTax, rates: TaxRate[]): TaxRate | null {
  if (tax.tax_manual) return null;
  const rateId = tax.tax_rate_id ?? tax.auto_rate_id ?? rates.find((rate) => rate.is_active && rate.is_default_purchases)?.id ?? null;
  return rates.find((rate) => rate.id === rateId) ?? null;
}

/** The line's tax and total as the server will compute them. */
export function purchaseLinePreview(
  line: { quantity: string; unitCost: string; discount?: string; tax: PurchaseLineTax },
  rates: TaxRate[],
): { tax: number; total: number } {
  const rate = previewRate(line.tax, rates);
  const amounts = computeLine({
    quantity: line.quantity || "0",
    unitPrice: line.unitCost || "0",
    discount: line.discount || "0",
    rate: line.tax.tax_manual ? null : (rate?.rate ?? "0"),
    tax: line.tax.tax_amount,
  });
  return { tax: unitsToNumber(amounts.tax), total: unitsToNumber(amounts.total) };
}

export function usePurchaseTaxRates(): TaxRate[] {
  return useTaxRates().data ?? [];
}

/** The tax cell of a purchase line: the rate select, and the amount when it is typed. */
export function PurchaseLineTaxCell({
  value,
  onChange,
  rates,
  label,
  cellProps,
}: {
  value: PurchaseLineTax;
  onChange: (next: PurchaseLineTax) => void;
  rates: TaxRate[];
  label: string;
  cellProps: ReturnType<LineCellContext["cellProps"]>;
}) {
  const auto = previewRate({ ...value, tax_rate_id: null, tax_manual: false }, rates);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <LineTaxSelect
        value={value}
        onChange={(next) => onChange({ ...value, ...next, tax_amount: next.tax_amount ?? value.tax_amount })}
        ariaLabel={`Tax for ${label}`}
        autoLabel={auto ? `Automatic (${auto.name})` : "Automatic"}
      />
      {lineTaxValue(value) === CUSTOM_TAX ? (
        <LineNumberInput
          cellProps={cellProps}
          value={value.tax_amount}
          onChange={(amount) => onChange({ ...value, tax_amount: amount })}
          ariaLabel={`Tax amount for ${label}`}
        />
      ) : null}
    </div>
  );
}
