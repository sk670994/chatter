import { NextResponse } from "next/server";
import { generateReplyWithFallback, GeminiConfigError, GeminiError } from "@/lib/server/gemini";
import {
  getConversationHistory,
  setConversationHistory,
} from "@/lib/server/historyStore";
import { getToolByName, getToolDeclarations } from "@/lib/tools";

type ChatRequest = {
  conversationId?: string;
  message?: string;
};

const TOOL_TIMEOUT_MS = 8000;
const WEATHER_INTENT_REGEX =
  /\b(weather|temperature|forecast|rain|raining|wind|humidity|climate)\b/i;
const AIR_QUALITY_INTENT_REGEX = /\b(air quality|aqi|pm2\.?5|pm10|pollution)\b/i;
const TIME_INTENT_REGEX = /\b(time in|local time|current time|timezone)\b/i;
const GEOCODE_INTENT_REGEX = /\b(geocode|coordinates|latitude|longitude|lat long)\b/i;
const CURRENCY_INTENT_REGEX =
  /\b(convert|conversion|exchange rate|currency|currancy|currencty|usd|inr|eur|gbp|jpy|aed|cad)\b/i;
const KNOWN_LOCATIONS_REGEX =
  /\b(india|china|japan|sri lanka|srilanka|delhi|noida|mumbai|london|paris|tokyo|new york|usa|united states)\b/gi;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, timeoutMessage: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(timeoutMessage)), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function extractWeatherLocation(message: string): string | null {
  const normalized = message.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:weather|time|air quality)\s+(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,-]{1,60})/i,
    /\b(?:in|for|at)\s+([a-zA-Z][a-zA-Z\s,-]{1,60})/i,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const value = match?.[1]?.replace(/[?.!,;:]+$/g, "").trim();
    if (value && value.length >= 2) {
      return value;
    }
  }

  return null;
}

function extractLocationForIntent(message: string): string | null {
  const stopWords = new Set([
    "current",
    "weather",
    "time",
    "currency",
    "compared",
    "compare",
    "dollar",
    "america",
    "american",
    "usd",
    "inr",
    "rate",
  ]);

  const sanitize = (raw: string): string | null => {
    const cleaned = raw
      .replace(/[?.!,;:]+$/g, "")
      .trim()
      .replace(/\s+/g, " ");
    const tokens = cleaned.split(" ").filter(Boolean);
    if (!tokens.length) {
      return null;
    }

    const filtered = tokens.filter((token) => !stopWords.has(token.toLowerCase()));
    const candidateTokens = (filtered.length ? filtered : tokens).slice(-3);
    const candidate = candidateTokens.join(" ").trim();
    if (candidate.length < 2) {
      return null;
    }
    return candidate;
  };

  const generic = extractWeatherLocation(message);
  if (generic) {
    const sanitized = sanitize(generic);
    if (sanitized) {
      return sanitized;
    }
  }

  const trailingRaw = message
    .replace(/\s+/g, " ")
    .trim()
    .match(/\b(?:in|of|for)\s+([a-zA-Z][a-zA-Z\s,-]{1,60})$/i)?.[1];
  const trailing = trailingRaw ? sanitize(trailingRaw) : null;
  if (trailing) {
    return trailing;
  }

  const knownPlaceMatch = message.match(
    /\b(india|china|japan|delhi|noida|mumbai|london|paris|tokyo|new york|usa|united states)\b/i,
  );
  if (knownPlaceMatch?.[1]) {
    const normalized = knownPlaceMatch[1]
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase());
    return normalized;
  }

  return null;
}

function extractMultipleLocations(message: string): string[] {
  const matches = message.match(KNOWN_LOCATIONS_REGEX) ?? [];
  const unique = new Set<string>();

  for (const raw of matches) {
    const normalized = raw
      .toLowerCase()
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .replace("Srilanka", "Sri Lanka");
    unique.add(normalized);
  }

  return [...unique];
}

function extractCurrencyArgs(
  message: string,
): { from: string; to: string; amount: number } | null {
  const normalized = message.toUpperCase();
  const amountMatch = normalized.match(/(\d+(?:\.\d+)?)/);
  const amount = amountMatch ? Number(amountMatch[1]) : 1;
  const codes = normalized.match(/\b[A-Z]{3}\b/g) ?? [];
  const uniqueCodes = [...new Set(codes)];

  if (uniqueCodes.length >= 2) {
    return { from: uniqueCodes[0], to: uniqueCodes[1], amount };
  }

  const pairMatch = normalized.match(/\b([A-Z]{3})\s*(?:TO|INTO)\s*([A-Z]{3})\b/);
  if (pairMatch) {
    return {
      from: pairMatch[1],
      to: pairMatch[2],
      amount,
    };
  }

  const inferredFrom =
    /\b(US DOLLAR|AMERICAN DOLLAR|USD|DOLLAR)\b/.test(normalized) ? "USD" : null;
  const inferredTo =
    /\b(INDIA|INDIAN RUPEE|INR|RUPEE)\b/.test(normalized) ? "INR" : null;
  if (inferredFrom && inferredTo) {
    return { from: inferredFrom, to: inferredTo, amount };
  }

  return null;
}

function toFiniteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function toStringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function formatDirectWeatherReply(raw: Record<string, unknown>): string | null {
  const ok = raw.ok === true;
  if (!ok) {
    const errorMessage = typeof raw.error === "string" ? raw.error : "Weather data unavailable.";
    return `I could not fetch live weather right now. ${errorMessage}`;
  }

  const location = (raw.location ?? {}) as Record<string, unknown>;
  const current = (raw.current ?? {}) as Record<string, unknown>;

  const city = toStringValue(location.name) || "Requested location";
  const country = toStringValue(location.country);
  const placeLabel = country ? `${city}, ${country}` : city;

  const temperature = toFiniteNumber(current.temperatureC);
  const windSpeed = toFiniteNumber(current.windSpeedKmh);
  const summary = toStringValue(current.summary) || "Unknown";
  const observedAt = toStringValue(current.time);

  const parts = [
    `Live weather for ${placeLabel}:`,
    temperature != null ? `Temperature: ${temperature} deg C.` : "Temperature: unavailable.",
    windSpeed != null ? `Wind speed: ${windSpeed} km/h.` : "Wind speed: unavailable.",
    `Condition: ${summary}.`,
    observedAt ? `Observed at: ${observedAt}.` : "",
  ].filter(Boolean);

  return parts.join("\n");
}

function formatDirectAirQualityReply(raw: Record<string, unknown>): string {
  if (raw.ok !== true) {
    const errorMessage = typeof raw.error === "string" ? raw.error : "Air quality unavailable.";
    return `I could not fetch air quality right now. ${errorMessage}`;
  }

  const location = (raw.location ?? {}) as Record<string, unknown>;
  const current = (raw.current ?? {}) as Record<string, unknown>;
  const city = toStringValue(location.name) || "Requested location";
  const country = toStringValue(location.country);
  const placeLabel = country ? `${city}, ${country}` : city;

  const usAqi = toFiniteNumber(current.usAqi);
  const pm25 = toFiniteNumber(current.pm25);
  const pm10 = toFiniteNumber(current.pm10);
  const observedAt = toStringValue(current.time);

  return [
    `Live air quality for ${placeLabel}:`,
    usAqi != null ? `US AQI: ${usAqi}.` : "US AQI: unavailable.",
    pm25 != null ? `PM2.5: ${pm25} ug/m3.` : "PM2.5: unavailable.",
    pm10 != null ? `PM10: ${pm10} ug/m3.` : "PM10: unavailable.",
    observedAt ? `Observed at: ${observedAt}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDirectTimeReply(raw: Record<string, unknown>): string {
  if (raw.ok !== true) {
    const errorMessage = typeof raw.error === "string" ? raw.error : "Time data unavailable.";
    return `I could not fetch local time right now. ${errorMessage}`;
  }

  const location = (raw.location ?? {}) as Record<string, unknown>;
  const current = (raw.current ?? {}) as Record<string, unknown>;
  const city = toStringValue(location.name) || "Requested location";
  const country = toStringValue(location.country);
  const placeLabel = country ? `${city}, ${country}` : city;
  const datetime = toStringValue(current.datetime);
  const timezone = toStringValue(current.timezone);
  const utcOffset = toStringValue(current.utcOffset);

  return [
    `Local time for ${placeLabel}:`,
    datetime ? `DateTime: ${datetime}.` : "DateTime: unavailable.",
    timezone ? `Timezone: ${timezone}.` : "",
    utcOffset ? `UTC Offset: ${utcOffset}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDirectGeocodeReply(raw: Record<string, unknown>): string {
  if (raw.ok !== true) {
    const errorMessage = typeof raw.error === "string" ? raw.error : "Geocode unavailable.";
    return `I could not geocode the location right now. ${errorMessage}`;
  }

  const location = (raw.location ?? {}) as Record<string, unknown>;
  const city = toStringValue(location.name) || "Requested location";
  const country = toStringValue(location.country);
  const placeLabel = country ? `${city}, ${country}` : city;
  const latitude = toFiniteNumber(location.latitude);
  const longitude = toFiniteNumber(location.longitude);
  const timezone = toStringValue(location.timezone);

  return [
    `Coordinates for ${placeLabel}:`,
    latitude != null ? `Latitude: ${latitude}.` : "Latitude: unavailable.",
    longitude != null ? `Longitude: ${longitude}.` : "Longitude: unavailable.",
    timezone ? `Timezone: ${timezone}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function formatDirectCurrencyReply(raw: Record<string, unknown>): string {
  if (raw.ok !== true) {
    const errorMessage =
      typeof raw.error === "string" ? raw.error : "Currency conversion unavailable.";
    return `I could not convert currency right now. ${errorMessage}`;
  }

  const from = toStringValue(raw.from);
  const to = toStringValue(raw.to);
  const amount = toFiniteNumber(raw.amount);
  const convertedAmount = toFiniteNumber(raw.convertedAmount);
  const date = toStringValue(raw.date);

  return [
    "Live currency conversion:",
    amount != null && convertedAmount != null && from && to
      ? `${amount} ${from} = ${convertedAmount} ${to}.`
      : "Conversion data unavailable.",
    date ? `Rate date: ${date}.` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function joinSections(sections: string[]): string {
  return sections.filter(Boolean).join("\n\n");
}

export async function POST(request: Request) {
  let payload: ChatRequest;

  try {
    payload = (await request.json()) as ChatRequest;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const message = payload.message?.trim();
  if (!message) {
    return NextResponse.json({ error: "message is required" }, { status: 400 });
  }

  const conversationId = payload.conversationId?.trim() || crypto.randomUUID();
  const priorHistory = getConversationHistory(conversationId);
  const userTurn = { role: "user" as const, parts: [{ text: message }] };
  const contents = [...priorHistory, userTurn];
  const toolDeclarations = getToolDeclarations();
  const isWeatherIntent = WEATHER_INTENT_REGEX.test(message);
  const isAirQualityIntent = AIR_QUALITY_INTENT_REGEX.test(message);
  const isTimeIntent = TIME_INTENT_REGEX.test(message);
  const isGeocodeIntent = GEOCODE_INTENT_REGEX.test(message);
  const isCurrencyIntent = CURRENCY_INTENT_REGEX.test(message);

  try {
    const llmResult = await generateReplyWithFallback(contents, {
      tools: toolDeclarations,
      executeTool: async (name, args) => {
        const tool = getToolByName(name);
        if (!tool) {
          return {
            ok: false,
            error: `Unknown tool: ${name}`,
          };
        }

        return withTimeout(
          tool.run(args),
          TOOL_TIMEOUT_MS,
          `Tool ${name} timed out after ${TOOL_TIMEOUT_MS}ms.`,
        );
      },
    });

    if (llmResult.toolCallsUsed === 0) {
      const location = extractLocationForIntent(message);
      const currencyArgs = extractCurrencyArgs(message);
      const matchedIntentCount = [
        isWeatherIntent,
        isAirQualityIntent,
        isTimeIntent,
        isGeocodeIntent,
        isCurrencyIntent,
      ].filter(Boolean).length;

      if (matchedIntentCount > 1) {
        const sections: string[] = [];
        const usedToolNames: string[] = [];

        async function runDirectTool(
          name: string,
          args: Record<string, unknown> | null,
          timeoutMessage: string,
        ): Promise<Record<string, unknown> | null> {
          if (!args) {
            return null;
          }
          const tool = getToolByName(name);
          if (!tool) {
            return null;
          }
          return withTimeout(tool.run(args), TOOL_TIMEOUT_MS, timeoutMessage);
        }

        if (isWeatherIntent) {
          const result = await runDirectTool(
            "get_weather",
            location ? { location } : null,
            `Tool get_weather timed out after ${TOOL_TIMEOUT_MS}ms.`,
          );
          if (result) {
            sections.push(
              formatDirectWeatherReply(result) ??
                "I could not fetch live weather right now. Please try again.",
            );
            if (result.ok === true) {
              usedToolNames.push("get_weather");
            }
          }
        }

        if (isTimeIntent) {
          const result = await runDirectTool(
            "time_in_location",
            location ? { location } : null,
            `Tool time_in_location timed out after ${TOOL_TIMEOUT_MS}ms.`,
          );
          if (result) {
            sections.push(formatDirectTimeReply(result));
            if (result.ok === true) {
              usedToolNames.push("time_in_location");
            }
          }
        }

        if (isCurrencyIntent) {
          const result = await runDirectTool(
            "currency_convert",
            currencyArgs,
            `Tool currency_convert timed out after ${TOOL_TIMEOUT_MS}ms.`,
          );
          if (result) {
            sections.push(formatDirectCurrencyReply(result));
            if (result.ok === true) {
              usedToolNames.push("currency_convert");
            }
          }
        }

        if (isAirQualityIntent) {
          const result = await runDirectTool(
            "air_quality",
            location ? { location } : null,
            `Tool air_quality timed out after ${TOOL_TIMEOUT_MS}ms.`,
          );
          if (result) {
            sections.push(formatDirectAirQualityReply(result));
            if (result.ok === true) {
              usedToolNames.push("air_quality");
            }
          }
        }

        if (isGeocodeIntent) {
          const result = await runDirectTool(
            "geocode_location",
            location ? { location } : null,
            `Tool geocode_location timed out after ${TOOL_TIMEOUT_MS}ms.`,
          );
          if (result) {
            sections.push(formatDirectGeocodeReply(result));
            if (result.ok === true) {
              usedToolNames.push("geocode_location");
            }
          }
        }

        const combinedReply = sections.length
          ? joinSections(sections)
          : "I could not determine enough details from your combined request. Please specify city and currencies clearly (example: weather in Delhi, time in Delhi, convert 1 USD to INR).";
        const combinedHistory = setConversationHistory(conversationId, [
          ...priorHistory,
          userTurn,
          { role: "model", parts: [{ text: combinedReply }] },
        ]);

        return NextResponse.json({
          reply: combinedReply,
          conversationId,
          model: llmResult.model,
          history: combinedHistory,
          toolCallsUsed: usedToolNames.length,
          attemptedModels: llmResult.attemptedModels,
          liveDataUsed: usedToolNames.length > 0,
          toolName: usedToolNames[0] ?? null,
          toolSource: usedToolNames.length > 0 ? "direct_fallback" : null,
          toolNamesUsed: usedToolNames,
        });
      }

      type DirectFallbackConfig = {
        name: string;
        args: Record<string, unknown> | null;
        timeoutMessage: string;
        formatReply: (raw: Record<string, unknown>) => string;
      };

      let directConfig: DirectFallbackConfig | null = null;
      if (isWeatherIntent) {
        directConfig = {
          name: "get_weather",
          args: location ? { location } : null,
          timeoutMessage: `Tool get_weather timed out after ${TOOL_TIMEOUT_MS}ms.`,
          formatReply: (raw) =>
            formatDirectWeatherReply(raw) ??
            "I could not fetch live weather right now. Please try again in a moment.",
        };
      } else if (isAirQualityIntent) {
        directConfig = {
          name: "air_quality",
          args: location ? { location } : null,
          timeoutMessage: `Tool air_quality timed out after ${TOOL_TIMEOUT_MS}ms.`,
          formatReply: formatDirectAirQualityReply,
        };
      } else if (isTimeIntent) {
        directConfig = {
          name: "time_in_location",
          args: location ? { location } : null,
          timeoutMessage: `Tool time_in_location timed out after ${TOOL_TIMEOUT_MS}ms.`,
          formatReply: formatDirectTimeReply,
        };
      } else if (isGeocodeIntent) {
        directConfig = {
          name: "geocode_location",
          args: location ? { location } : null,
          timeoutMessage: `Tool geocode_location timed out after ${TOOL_TIMEOUT_MS}ms.`,
          formatReply: formatDirectGeocodeReply,
        };
      } else if (isCurrencyIntent) {
        const args = extractCurrencyArgs(message);
        directConfig = {
          name: "currency_convert",
          args,
          timeoutMessage: `Tool currency_convert timed out after ${TOOL_TIMEOUT_MS}ms.`,
          formatReply: formatDirectCurrencyReply,
        };
      }

      if (directConfig) {
        if (directConfig.name === "air_quality") {
          const locations = extractMultipleLocations(message);
          if (locations.length > 1) {
            const sections: string[] = [];
            let successfulCount = 0;
            const airQualityTool = getToolByName("air_quality");
            for (const location of locations) {
              if (!airQualityTool) {
                break;
              }
              const result = await withTimeout(
                airQualityTool.run({ location }),
                TOOL_TIMEOUT_MS,
                `Tool air_quality timed out after ${TOOL_TIMEOUT_MS}ms.`,
              );
              sections.push(formatDirectAirQualityReply(result));
              if (result.ok === true) {
                successfulCount += 1;
              }
            }

            const multiReply = sections.join("\n\n");
            const multiHistory = setConversationHistory(conversationId, [
              ...priorHistory,
              userTurn,
              { role: "model", parts: [{ text: multiReply }] },
            ]);

            return NextResponse.json({
              reply: multiReply,
              conversationId,
              model: llmResult.model,
              history: multiHistory,
              toolCallsUsed: successfulCount,
              attemptedModels: llmResult.attemptedModels,
              liveDataUsed: successfulCount > 0,
              toolName: successfulCount > 0 ? "air_quality" : null,
              toolSource: successfulCount > 0 ? "direct_fallback" : null,
              toolNamesUsed: successfulCount > 0 ? ["air_quality"] : [],
            });
          }
        }

        const directTool = getToolByName(directConfig.name);
        let directToolResult: Record<string, unknown> | null = null;

        if (directTool && directConfig.args) {
          directToolResult = await withTimeout(
            directTool.run(directConfig.args),
            TOOL_TIMEOUT_MS,
            directConfig.timeoutMessage,
          );
        }

        const strictReply = directToolResult
          ? directConfig.formatReply(directToolResult)
          : "I could not determine the required inputs for this tool request. Please be more specific.";

        const strictHistory = setConversationHistory(conversationId, [
          ...priorHistory,
          userTurn,
          { role: "model", parts: [{ text: strictReply }] },
        ]);

        return NextResponse.json({
          reply: strictReply,
          conversationId,
          model: llmResult.model,
          history: strictHistory,
          toolCallsUsed: directToolResult?.ok === true ? 1 : 0,
          attemptedModels: llmResult.attemptedModels,
          liveDataUsed: directToolResult?.ok === true,
          toolName: directToolResult?.ok === true ? directConfig.name : null,
          toolSource: directToolResult?.ok === true ? "direct_fallback" : null,
          toolNamesUsed: directToolResult?.ok === true ? [directConfig.name] : [],
        });
      }
    }

    const updatedHistory = setConversationHistory(conversationId, llmResult.contents);

    return NextResponse.json({
      reply: llmResult.reply,
      conversationId,
      model: llmResult.model,
      history: updatedHistory,
      toolCallsUsed: llmResult.toolCallsUsed,
      attemptedModels: llmResult.attemptedModels,
      liveDataUsed: llmResult.toolCallsUsed > 0,
      toolName: llmResult.toolNamesUsed[0] ?? null,
      toolSource: llmResult.toolCallsUsed > 0 ? "gemini_function_call" : null,
      toolNamesUsed: llmResult.toolNamesUsed,
    });
  } catch (error) {
    if (error instanceof GeminiConfigError) {
      return NextResponse.json(
        { error: "Server is missing LLM configuration. Add GEMINI_API_KEY." },
        { status: 500 },
      );
    }

    if (error instanceof GeminiError) {
      const status = error.status >= 400 ? error.status : 502;
      return NextResponse.json(
        {
          error:
            status >= 500
              ? "Upstream LLM request failed. Try again in a moment."
              : error.message,
        },
        { status },
      );
    }

    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
