import { getToolByName } from "@/lib/tools/registry";

export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const tool = getToolByName(name);

  if (!tool) {
    throw new Error(`Tool not found: ${name}`);
  }

  return tool.run(args);
}
