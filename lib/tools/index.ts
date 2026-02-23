import { getWeatherTool } from "@/lib/tools/getWeather";
import { currencyConvertTool } from "@/lib/tools/currencyConvert";
import { geocodeLocationTool } from "@/lib/tools/geocodeLocation";
import { airQualityTool } from "@/lib/tools/airQuality";
import { timeInLocationTool } from "@/lib/tools/timeInLocation";
import type { ToolDeclaration, ToolRuntime } from "@/lib/tools/types";

const tools: ToolRuntime[] = [
  getWeatherTool,
  currencyConvertTool,
  geocodeLocationTool,
  airQualityTool,
  timeInLocationTool,
];

const toolByName = new Map<string, ToolRuntime>(
  tools.map((tool) => [tool.declaration.name, tool]),
);

export function getToolDeclarations(): ToolDeclaration[] {
  return tools.map((tool) => tool.declaration);
}

export function getToolByName(name: string): ToolRuntime | undefined {
  return toolByName.get(name);
}
