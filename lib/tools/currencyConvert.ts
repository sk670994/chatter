import { fetchJson } from "@/lib/tools/common";
import type { ToolRuntime } from "@/lib/tools/types";

type CurrencyResponse = {
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

function parseCurrencyCode(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length !== 3) {
    throw new Error(`${field} must be a 3-letter currency code (e.g. USD, INR).`);
  }
  return value.trim().toUpperCase();
}

function parseAmount(value: unknown): number {
  if (value == null) {
    return 1;
  }
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("amount must be a positive number.");
  }
  return amount;
}

export const currencyConvertTool: ToolRuntime = {
  declaration: {
    name: "currency_convert",
    description:
      "Convert amount between currencies using live exchange rates (Frankfurter API).",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Base currency code, e.g. USD" },
        to: { type: "string", description: "Target currency code, e.g. INR" },
        amount: { type: "number", description: "Amount to convert. Default is 1." },
      },
      required: ["from", "to"],
    },
  },
  async run(args: Record<string, unknown>) {
    try {
      const from = parseCurrencyCode(args.from, "from");
      const to = parseCurrencyCode(args.to, "to");
      const amount = parseAmount(args.amount);

      const url =
        `https://api.frankfurter.app/latest?amount=${encodeURIComponent(String(amount))}` +
        `&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
      const data = await fetchJson<CurrencyResponse>(url);
      const convertedAmount = data.rates?.[to];

      if (typeof convertedAmount !== "number") {
        return {
          ok: false,
          error: "Currency conversion data unavailable for requested pair.",
        };
      }

      return {
        ok: true,
        from,
        to,
        amount,
        convertedAmount,
        date: data.date ?? "",
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected currency tool error.",
      };
    }
  },
};
