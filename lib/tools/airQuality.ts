import { fetchJson, geocodeLocation, parseLocationArg } from "@/lib/tools/common";
import type { ToolRuntime } from "@/lib/tools/types";

type AirQualityResponse = {
  current?: {
    time?: string;
    us_aqi?: number;
    european_aqi?: number;
    pm2_5?: number;
    pm10?: number;
  };
};

export const airQualityTool: ToolRuntime = {
  declaration: {
    name: "air_quality",
    description:
      "Get current air quality metrics (AQI, PM2.5, PM10) for a location using Open-Meteo air quality API.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or place name, e.g. Delhi, Noida, London.",
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
          error: `Could not find location "${location}" for air quality lookup.`,
        };
      }

      const url =
        `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${encodeURIComponent(String(place.latitude))}` +
        `&longitude=${encodeURIComponent(String(place.longitude))}` +
        "&current=us_aqi,european_aqi,pm2_5,pm10&timezone=auto";
      const data = await fetchJson<AirQualityResponse>(url);
      const current = data.current;
      if (!current) {
        return {
          ok: false,
          error: `Air quality data is unavailable for "${location}" right now.`,
        };
      }

      return {
        ok: true,
        location: place,
        current: {
          time: current.time ?? "",
          usAqi: current.us_aqi ?? null,
          euAqi: current.european_aqi ?? null,
          pm25: current.pm2_5 ?? null,
          pm10: current.pm10 ?? null,
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected air quality tool error.",
      };
    }
  },
};
