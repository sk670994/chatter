import { fetchJson, geocodeLocation, parseLocationArg } from "@/lib/tools/common";
import type { ToolRuntime } from "@/lib/tools/types";

type OpenMeteoTimeResponse = {
  timezone?: string;
  utc_offset_seconds?: number;
  current?: {
    time?: string;
  };
};

export const timeTool: ToolRuntime = {
  declaration: {
    name: "time_in_location",
    description:
      "Get current local date/time and UTC offset for a city or location.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or place name, e.g. Noida, Tokyo, New York.",
        },
      },
      required: ["location"],
    },
  },
  async run(args: Record<string, unknown>) {
    try {
      const location = parseLocationArg(args);
      const place = await geocodeLocation(location);
      if (!place) {
        return {
          ok: false,
          error: `Could not find location "${location}" for time lookup.`,
        };
      }

      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(place.latitude))}` +
        `&longitude=${encodeURIComponent(String(place.longitude))}` +
        "&current=temperature_2m&timezone=auto";
      const data = await fetchJson<OpenMeteoTimeResponse>(url);
      const utcOffsetSeconds = data.utc_offset_seconds;
      const sign = typeof utcOffsetSeconds === "number" && utcOffsetSeconds >= 0 ? "+" : "-";
      const abs = typeof utcOffsetSeconds === "number" ? Math.abs(utcOffsetSeconds) : null;
      const offsetHours = abs != null ? String(Math.floor(abs / 3600)).padStart(2, "0") : "";
      const offsetMinutes = abs != null ? String(Math.floor((abs % 3600) / 60)).padStart(2, "0") : "";
      const utcOffset = abs != null ? `${sign}${offsetHours}:${offsetMinutes}` : "";

      return {
        ok: true,
        location: place,
        current: {
          datetime: data.current?.time ?? "",
          timezone: data.timezone ?? place.timezone ?? "",
          utcOffset,
          dayOfWeek: null,
          dayOfYear: null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected time tool error.",
      };
    }
  },
};
