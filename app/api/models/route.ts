import { NextResponse } from "next/server";
import { getGeminiModels } from "@/lib/server/modelConfig";

export async function GET() {
  return NextResponse.json({ models: getGeminiModels() });
}
