const TOOL_HTTP_TIMEOUT_MS = 8000;

type GeocodingResponse = {
  results?: Array<{
    name?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
    timezone?: string;
  }>;
};
type GeocodingResult = NonNullable<GeocodingResponse["results"]>[number];

export type GeocodedPlace = {
  name: string;
  country: string;
  latitude: number;
  longitude: number;
  timezone: string;
};

export function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string,
): Promise<T> {
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

export async function fetchJson<T>(url: string): Promise<T> {
  const response = await withTimeout(
    fetch(url),
    TOOL_HTTP_TIMEOUT_MS,
    "Tool HTTP request timed out.",
  );
  if (!response.ok) {
    throw new Error(`Tool API request failed with status ${response.status}.`);
  }
  return (await response.json()) as T;
}

export function parseLocationArg(args: Record<string, unknown>): string {
  const location = args.location;
  if (typeof location !== "string" || location.trim().length < 2) {
    throw new Error("location must be a non-empty string with at least 2 characters.");
  }
  return location.trim();
}

function normalizeLocationText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

function normalizeLocationInput(location: string): string {
  const cleaned = location
    .trim()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");

  if (!cleaned) {
    return cleaned;
  }

  return cleaned
    .split(" ")
    .map((token) => {
      if (token.length <= 3) {
        return token.toUpperCase();
      }
      return token.charAt(0).toUpperCase() + token.slice(1).toLowerCase();
    })
    .join(" ");
}

function buildGeocodeCandidates(location: string): string[] {
  const normalized = normalizeLocationInput(location);
  const unique = new Set<string>();
  if (normalized) {
    unique.add(normalized);
  }

  const words = normalized.split(" ").filter(Boolean);
  if (words.length >= 2) {
    unique.add(`${words[0]}, ${words[words.length - 1]}`);
    unique.add(words[0]);
    unique.add(words[words.length - 1]);
  }

  return [...unique];
}

function pickBestGeocodeResult(
  requestedLocation: string,
  results: NonNullable<GeocodingResponse["results"]>,
): GeocodingResult | null {
  const requested = normalizeLocationText(requestedLocation);
  let best: GeocodingResult | null = null;
  let bestScore = -1;

  for (const result of results) {
    if (
      !result ||
      result.latitude == null ||
      result.longitude == null ||
      typeof result.name !== "string"
    ) {
      continue;
    }

    const name = normalizeLocationText(result.name);
    const country = normalizeLocationText(result.country ?? "");
    let score = 0;

    if (country === requested) {
      score += 120;
    }
    if (name === requested) {
      score += 100;
    }
    if (name.startsWith(requested) || country.startsWith(requested)) {
      score += 40;
    }
    if (name.includes(requested) || country.includes(requested)) {
      score += 20;
    }

    if (score > bestScore) {
      bestScore = score;
      best = result;
    }
  }

  return best ?? results[0] ?? null;
}

export async function geocodeLocation(location: string): Promise<GeocodedPlace | null> {
  const candidates = buildGeocodeCandidates(location);

  for (const candidate of candidates) {
    const geocodeUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(
      candidate,
    )}&count=10&language=en&format=json`;
    const geocoding = await fetchJson<GeocodingResponse>(geocodeUrl);
    const place = geocoding.results
      ? pickBestGeocodeResult(candidate, geocoding.results)
      : null;

    if (
      !place ||
      place.latitude == null ||
      place.longitude == null ||
      typeof place.name !== "string"
    ) {
      continue;
    }

    return {
      name: place.name,
      country: place.country ?? "",
      latitude: place.latitude,
      longitude: place.longitude,
      timezone: place.timezone ?? "",
    };
  }

  return null;
}
