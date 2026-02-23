import { fetchJson } from "@/lib/tools/common";
import type { ToolRuntime } from "@/lib/tools/types";

type CurrencyResponse = {
  success?: boolean;
  result?: number;
  amount?: number;
  base?: string;
  date?: string;
  rates?: Record<string, number>;
};

type OpenExchangeResponse = {
  result?: string;
  time_last_update_utc?: string;
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

export const currencyTool: ToolRuntime = {
  declaration: {
    name: "currency_convert",
    description:
      "Convert amount between currencies using live exchange rates (exchangerate.host API).",
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

      try {
        const url = `https://api.exchangerate.host/convert?from=${encodeURIComponent(
          from,
        )}&to=${encodeURIComponent(to)}&amount=${encodeURIComponent(String(amount))}`;
        const data = await fetchJson<CurrencyResponse>(url);
        const convertedAmount =
          typeof data.result === "number" ? data.result : data.rates?.[to];

        if (typeof convertedAmount === "number") {
          return {
            ok: true,
            from,
            to,
            amount,
            convertedAmount,
            date: data.date ?? "",
            source: "exchangerate.host",
          };
        }
      } catch {
        // Try fallback provider below.
      }

      const fallbackUrl = `https://open.er-api.com/v6/latest/${encodeURIComponent(from)}`;
      const fallbackData = await fetchJson<OpenExchangeResponse>(fallbackUrl);
      const rate = fallbackData.rates?.[to];
      if (typeof rate !== "number") {
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
        convertedAmount: amount * rate,
        date: fallbackData.time_last_update_utc ?? "",
        source: "open-er-api",
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected currency tool error.",
      };
    }
  },
};
