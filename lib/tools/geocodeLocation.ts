import { geocodeLocation, parseLocationArg } from "@/lib/tools/common";
import type { ToolRuntime } from "@/lib/tools/types";

export const geocodeLocationTool: ToolRuntime = {
  declaration: {
    name: "geocode_location",
    description:
      "Convert a place name into geographic coordinates and timezone. Use this for map/location context.",
    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description: "City or place name, for example: Noida, Delhi, London.",
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
          error: `Could not geocode "${location}".`,
        };
      }

      return {
        ok: true,
        location: place,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "Unexpected geocode error.",
      };
    }
  },
};
