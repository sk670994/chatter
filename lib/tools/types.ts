export type ToolDeclaration = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
};

export type ToolRunResult = Record<string, unknown>;

export type ToolRuntime = {
  declaration: ToolDeclaration;
  run: (args: Record<string, unknown>) => Promise<ToolRunResult>;
};
