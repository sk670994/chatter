import { currencyTool } from "@/lib/tools/currencyTool";
import { timeTool } from "@/lib/tools/timeTool";
import type { ToolDeclaration, ToolRuntime } from "@/lib/tools/types";
import { weatherTool } from "@/lib/tools/weatherTool";

const tools: ToolRuntime[] = [weatherTool, currencyTool, timeTool];

const toolByName = new Map<string, ToolRuntime>(
  tools.map((tool) => [tool.declaration.name, tool]),
);

export function getToolDeclarations(): ToolDeclaration[] {
  return tools.map((tool) => tool.declaration);
}

export function getToolByName(name: string): ToolRuntime | undefined {
  return toolByName.get(name);
}
