import { DisplayItemConfig } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

interface FuelArea {
  state: string;
  metro: string;
  label: string;
}

const ZIP_FUEL_AREAS: Record<string, FuelArea> = {
  "33066": {
    state: "FL",
    metro: "Fort Lauderdale",
    label: "FTL"
  }
};

export class FuelProvider {
  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async resolve(config: DisplayItemConfig) {
    const area = getFuelArea(config);
    const url = new URL("https://gasprices.aaa.com/");
    url.searchParams.set("state", area.state);

    const response = await this.fetchImpl(url.toString(), {
      headers: {
        accept: "text/html"
      }
    });

    if (!response.ok) {
      throw new Error(`AAA gas prices returned HTTP ${response.status}`);
    }

    const html = await response.text();
    const prices = parseMetroFuelPrices(html, area.metro) ?? parseStateFuelPrices(html, area.state);
    if (!prices) throw new Error(`Could not find fuel averages for ${area.metro}, ${area.state}`);

    const regular = prices.regular.toFixed(2);
    const diesel = prices.diesel.toFixed(2);
    const lines = sanitizeDisplayLines([`GAS AVG ${area.label}`, `REG${regular} DSL${diesel}`]);

    return {
      readableLines: lines,
      matrixLines: lines.map((line) => fitDisplayLine(line, 15)),
      debug: {
        zip: config.zip,
        source: "AAA Gas Prices",
        sourceArea: prices.area,
        state: area.state,
        metro: area.metro,
        regular,
        diesel
      },
      raw: {
        sourceUrl: url.toString()
      }
    };
  }
}

function getFuelArea(config: DisplayItemConfig): FuelArea {
  const zip = config.zip ?? "33066";
  const mapped = ZIP_FUEL_AREAS[zip];
  return {
    state: (config.state ?? mapped?.state ?? "FL").toUpperCase(),
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
