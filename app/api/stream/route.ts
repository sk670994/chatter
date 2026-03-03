import { NextRequest, NextResponse } from "next/server";

const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "llama3.2";
const FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? "*";

function withCors(headers: Record<string, string> = {}) {
  return {
    "Access-Control-Allow-Origin": FRONTEND_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    ...headers,
  };
}

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: withCors() });
}

export async function POST(request: NextRequest) {
  let body: { prompt?: string };

  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON body." },
      { status: 400, headers: withCors() }
    );
  }

  const prompt = body.prompt?.trim();
  if (!prompt) {
    return NextResponse.json(
      { error: "Prompt is required." },
      { status: 400, headers: withCors() }
    );
  }

  const upstream = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: OLLAMA_MODEL,
      prompt,
      stream: true,
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errorText = await upstream.text().catch(() => "");
    return NextResponse.json(
      {
        error: `Ollama request failed with status ${upstream.status}${
          errorText ? `: ${errorText}` : ""
        }`,
      },
      { status: 502, headers: withCors() }
    );
  }

  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();
      let buffer = "";
      let sentDone = false;

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            break;
          }

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const rawLine of lines) {
            const line = rawLine.trim();
            if (!line) {
              continue;
            }

            let payload: { response?: string; done?: boolean };
            try {
              payload = JSON.parse(line);
            } catch {
              continue;
            }

            if (payload.response) {
              controller.enqueue(encoder.encode(`data: ${payload.response}\n\n`));
            }

            if (payload.done) {
              controller.enqueue(encoder.encode("data: [DONE]\n\n"));
              sentDone = true;
              controller.close();
              return;
            }
          }
        }

        if (!sentDone) {
          controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        }
        controller.close();
      } catch (error) {
        const message = error instanceof Error ? error.message : "Stream error";
        controller.enqueue(encoder.encode(`data: Error: ${message}\n\n`));
        controller.close();
      } finally {
        reader.releaseLock();
      }
    },
  });

  return new NextResponse(stream, {
    headers: withCors({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    }),
  });
}
