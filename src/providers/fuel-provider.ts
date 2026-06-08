import { DisplayItemConfig } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

interface FuelArea {
  state: string;
  metro: string;
  label: string;
}

interface FuelResolved {
  readableLines: string[];
  matrixLines: string[];
  debug: Record<string, unknown>;
  raw: {
    sourceUrl: string;
  };
}

interface FuelCacheEntry {
  expiresAt: number;
  result?: FuelResolved;
  error?: Error;
}

const ZIP_FUEL_AREAS: Record<string, FuelArea> = {
  "33066": {
    state: "FL",
    metro: "Fort Lauderdale",
    label: "FTL"
  }
};

const METRO_ALIASES: Record<string, FuelArea> = {
  "FL:POMPANO BEACH": {
    state: "FL",
    metro: "Fort Lauderdale",
    label: "POMPA"
  }
};

const SUCCESS_CACHE_MS = 6 * 60 * 60 * 1000;
const ERROR_CACHE_MS = 15 * 60 * 1000;

export class FuelProvider {
  private readonly cache = new Map<string, FuelCacheEntry>();

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(config: DisplayItemConfig): Promise<FuelResolved> {
    const area = getFuelArea(config);
    const url = new URL("https://gasprices.aaa.com/");
    url.searchParams.set("state", area.state);
    const cacheKey = `${url.toString()}|${area.metro.toUpperCase()}`;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();
    if (cached && cached.expiresAt > now) {
      if (cached.result) return cached.result;
      if (cached.error) throw new Error(cached.error.message);
    }

    try {
      const response = await this.fetchImpl(url.toString(), {
        headers: {
          accept: "text/html"
        }
      });

      if (!response.ok) {
        warnFuelLookup("AAA gas prices returned a non-OK response", {
          id: config.id,
          zip: config.zip,
          state: area.state,
          metro: area.metro,
          sourceUrl: url.toString(),
          status: response.status,
          contentType: response.headers.get("content-type")
        });
        throw new Error(`AAA gas prices returned HTTP ${response.status}`);
      }

      const html = await response.text();
      const prices = parseMetroFuelPrices(html, area.metro) ?? parseStateFuelPrices(html, area.state);
      if (!prices) {
        warnFuelLookup("Could not parse AAA fuel averages", {
          id: config.id,
          zip: config.zip,
          state: area.state,
          metro: area.metro,
          label: area.label,
          sourceUrl: url.toString(),
          status: response.status,
          contentType: response.headers.get("content-type"),
          htmlLength: html.length,
          availableHeadings: extractFuelPageHeadings(html),
          htmlPreview: compactWhitespace(stripHtml(html)).slice(0, 500)
        });
        throw new Error(`Could not find fuel averages for ${area.metro}, ${area.state}`);
      }

      const regular = prices.regular.toFixed(2);
      const diesel = prices.diesel.toFixed(2);
      const lines = sanitizeDisplayLines([`GAS AVG ${area.label}`, `REG${regular} DSL${diesel}`]);

      const result = {
        readableLines: lines,
        matrixLines: lines.map((line) => fitDisplayLine(line, 15)),
        debug: {
          zip: config.zip,
          source: "AAA Gas Prices",
          sourceArea: prices.area,
          state: area.state,
          metro: area.metro,
          regular,
          diesel,
          cacheTtlMinutes: SUCCESS_CACHE_MS / 60_000
        },
        raw: {
          sourceUrl: url.toString()
        }
      };
      this.cache.set(cacheKey, { result, expiresAt: now + SUCCESS_CACHE_MS });
      return result;
    } catch (error) {
      const cachedError = error instanceof Error ? error : new Error(String(error));
      this.cache.set(cacheKey, { error: cachedError, expiresAt: now + ERROR_CACHE_MS });
      throw cachedError;
    }
  }
}

function getFuelArea(config: DisplayItemConfig): FuelArea {
  const zip = config.zip ?? "33066";
  const mapped = ZIP_FUEL_AREAS[zip];
  const state = (config.state ?? mapped?.state ?? "FL").toUpperCase();
  const alias = METRO_ALIASES[`${state}:${(config.metro ?? "").trim().toUpperCase()}`];
  if (alias) return alias;
  return {
    state,
    metro: config.metro ?? mapped?.metro ?? "Fort Lauderdale",
    label: (config.metro ?? mapped?.label ?? "LOCAL").slice(0, 5).toUpperCase()
  };
}

function parseMetroFuelPrices(html: string, metro: string): { area: string; regular: number; diesel: number } | undefined {
  const escapedMetro = escapeRegExp(metro);
  const htmlPattern = new RegExp(`<h3[^>]*>\\s*${escapedMetro}\\s*</h3>[\\s\\S]*?Current Avg\\.</td>\\s*<td>\\$(\\d+\\.\\d+)</td>\\s*<td>\\$(\\d+\\.\\d+)</td>\\s*<td>\\$(\\d+\\.\\d+)</td>\\s*<td>\\$(\\d+\\.\\d+)</td>`, "i");
  const textPattern = new RegExp(`###\\s*${escapedMetro}[\\s\\S]*?Current Avg\\.\\s*\\$(\\d+\\.\\d+)\\s*\\$(\\d+\\.\\d+)\\s*\\$(\\d+\\.\\d+)\\s*\\$(\\d+\\.\\d+)`, "i");
  const pattern = html.includes("<h3") ? htmlPattern : textPattern;
  const match = html.match(pattern);
  if (!match) return undefined;

  return {
    area: metro,
    regular: Number(match[1]),
    diesel: Number(match[4])
  };
}

function parseStateFuelPrices(html: string, state: string): { area: string; regular: number; diesel: number } | undefined {
  const htmlPattern = /<h2[^>]*>\s*[^<]*average gas prices\s*<\/h2>[\s\S]*?Current Avg\.<\/td>\s*<td>\$(\d+\.\d+)<\/td>\s*<td>\$(\d+\.\d+)<\/td>\s*<td>\$(\d+\.\d+)<\/td>\s*<td>\$(\d+\.\d+)<\/td>/i;
  const textPattern = /#\s+[^#]*average gas prices[\s\S]*?Current Avg\.\s*\$(\d+\.\d+)\s*\$(\d+\.\d+)\s*\$(\d+\.\d+)\s*\$(\d+\.\d+)/i;
  const pattern = html.includes("<h2") ? htmlPattern : textPattern;
  const match = html.match(pattern);
  if (!match) return undefined;

  return {
    area: `${state} state`,
    regular: Number(match[1]),
    diesel: Number(match[4])
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function warnFuelLookup(message: string, details: Record<string, unknown>): void {
  console.warn(`[FuelProvider] ${message}`, details);
}

function extractFuelPageHeadings(html: string): string[] {
  const htmlHeadings = Array.from(html.matchAll(/<h[23][^>]*>([\s\S]*?)<\/h[23]>/gi), (match) => cleanHeading(match[1]));
  const textHeadings = Array.from(html.matchAll(/^#{1,3}\s+(.+)$/gm), (match) => cleanHeading(match[1]));
  return unique([...htmlHeadings, ...textHeadings].filter(Boolean)).slice(0, 20);
}

function cleanHeading(value: string): string {
  return compactWhitespace(stripHtml(value)).slice(0, 120);
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#8211;/g, "-")
    .replace(/&#8217;/g, "'");
}

function compactWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
