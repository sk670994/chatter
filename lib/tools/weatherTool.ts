import type { ToolRuntime } from "@/lib/tools/types";
import { fetchJson, geocodeLocation, parseLocationArg } from "@/lib/tools/common";

type ForecastResponse = {
  current?: {
    time?: string;
    temperature_2m?: number;
    wind_speed_10m?: number;
    weather_code?: number;
  };
};

const WEATHER_CODE_MAP: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  56: "Light freezing drizzle",
  57: "Dense freezing drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  66: "Light freezing rain",
  67: "Heavy freezing rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  77: "Snow grains",
  80: "Slight rain showers",
  81: "Moderate rain showers",
  82: "Violent rain showers",
  85: "Slight snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with slight hail",
  99: "Thunderstorm with heavy hail",
};

export const weatherTool: ToolRuntime = {
  declaration: {
    name: "get_weather",
    description:
      "Get the current weather for a city or place name. Use this when the user asks about weather, temperature, rain, or forecast conditions.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or place name, for example: New York, London, Delhi.",
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
          error: `Could not find coordinates for "${location}".`,
        };
      }

      const forecastUrl =
        `https://api.open-meteo.com/v1/forecast?latitude=${encodeURIComponent(String(place.latitude))}` +
        `&longitude=${encodeURIComponent(String(place.longitude))}` +
        "&current=temperature_2m,wind_speed_10m,weather_code&timezone=auto";
      const forecast = await fetchJson<ForecastResponse>(forecastUrl);
      const current = forecast.current;

      if (!current) {
        return {
          ok: false,
          error: `Weather data is unavailable for "${location}" right now.`,
        };
      }

      const weatherCode = current.weather_code ?? -1;
      return {
        ok: true,
        location: {
          name: place.name ?? location,
          country: place.country ?? "",
          latitude: place.latitude,
          longitude: place.longitude,
        },
        current: {
          time: current.time ?? "",
          temperatureC: current.temperature_2m ?? null,
          windSpeedKmh: current.wind_speed_10m ?? null,
          weatherCode,
          summary: WEATHER_CODE_MAP[weatherCode] ?? "Unknown",
        },
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected weather tool error.",
      };
    }
  },
};
