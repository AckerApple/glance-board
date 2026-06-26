import assert from "node:assert/strict";
import test from "node:test";
import { DateTimeProvider } from "../src/providers/date-time-provider.js";
import { FuelProvider } from "../src/providers/fuel-provider.js";
import { InternetStatusProvider } from "../src/providers/internet-status-provider.js";
import { MoonProvider } from "../src/providers/moon-provider.js";
import { SportsProvider } from "../src/providers/sports-provider.js";
import { WeatherProvider } from "../src/providers/weather-provider.js";

test("date-time provider produces two display-safe lines", () => {
  const result = new DateTimeProvider().resolve(
    { id: "date", enabled: true, type: "date-time" },
    new Date("2026-06-06T13:30:00-04:00")
  );
  assert.equal(result.matrixLines.length, 2);
  assert.match(result.matrixLines[0], /:/);
  assert.equal(result.matrixLines[1], "JUNE 6");
});

test("moon provider returns bounded illumination and future full moon distance", () => {
  const result = new MoonProvider().resolve(
    { id: "moon", enabled: true, type: "moon-phase" },
    new Date("2026-06-06T12:00:00Z")
  );
  assert.ok(result.moon.illumination >= 0 && result.moon.illumination <= 1);
  assert.ok(result.moon.daysUntilFullMoon >= 0);
  assert.equal(result.matrixLines.length, 2);
});

test("weather provider includes current, low, high, humidity percent, and sunny signal", async () => {
  const provider = new WeatherProvider(async () => new Response(JSON.stringify({
    current: {
      temperature_2m: 80.2,
      relative_humidity_2m: 46,
      precipitation: 0,
      rain: 0,
      cloud_cover: 5,
      weather_code: 0
    },
    daily: {
      temperature_2m_min: [78.1],
      temperature_2m_max: [84.4]
    },
    hourly: {
      time: [],
      precipitation_probability: [],
      precipitation: [],
      rain: []
    }
  }), { status: 200, headers: { "content-type": "application/json" } }) as unknown as Response);

  const result = await provider.resolve({
    id: "local-weather",
    enabled: true,
    type: "weather-current",
    zip: "33066"
  });

  assert.equal(result.weather.temperature, 80);
  assert.equal(result.weather.lowTemperature, 78);
  assert.equal(result.weather.highTemperature, 84);
  assert.equal(result.weather.humidity, 46);
  assert.equal(result.weather.isSunny, true);
  assert.deepEqual(result.readableLines, ["80F L78 H84", "NO RAIN 72H 46%"]);
});

test("fuel provider maps Pompano Beach to the AAA Fort Lauderdale metro", async () => {
  const provider = new FuelProvider(async () => new Response(`
    ### Fort Lauderdale
    Regular Mid Premium Diesel
    Current Avg. $3.9210 $4.3940 $4.6920 $4.9770
  `, { status: 200, headers: { "content-type": "text/html" } }) as unknown as Response);

  const result = await provider.resolve({
    id: "local-fuel-average",
    enabled: true,
    type: "fuel-average",
    zip: "33066",
    state: "FL",
    metro: "Pompano Beach"
  });

  assert.equal(result.debug.sourceArea, "Fort Lauderdale");
  assert.deepEqual(result.readableLines, ["GAS AVG POMPA", "REG3.92 DSL4.98"]);
});

test("fuel provider caches successful AAA lookups", async () => {
  let fetchCount = 0;
  const provider = new FuelProvider(async () => {
    fetchCount += 1;
    return new Response(`
      ### Fort Lauderdale
      Regular Mid Premium Diesel
      Current Avg. $3.9210 $4.3940 $4.6920 $4.9770
    `, { status: 200, headers: { "content-type": "text/html" } }) as unknown as Response;
  });
  const config = { id: "fuel", enabled: true, type: "fuel-average" as const, zip: "33066" };

  await provider.resolve(config);
  await provider.resolve(config);

  assert.equal(fetchCount, 1);
});

test("internet status provider reports latency, throughput, and connection type", async () => {
  const provider = new InternetStatusProvider(
    async (_url, init) => {
      const bytes = init?.method === "POST" ? 2 : 1_000_000;
      return new Response(Buffer.alloc(bytes), { status: 200 }) as unknown as Response;
    },
    async () => ({ connectionType: "wifi", interfaceName: "en0" })
  );

  const result = await provider.resolve({
    id: "internet-status",
    enabled: true,
    type: "internet-status"
  });

  assert.equal(result.internet.online, true);
  assert.equal(result.internet.connectionType, "wifi");
  assert.equal(result.internet.interfaceName, "en0");
  assert.equal(typeof result.internet.latencyMs, "number");
  assert.equal(typeof result.internet.downloadMbps, "number");
  assert.equal(typeof result.internet.uploadMbps, "number");
  assert.deepEqual(result.matrixLines.length, 2);
  assert.match(result.matrixLines[0], /ONLINE/);
  assert.match(result.readableLines[1], /^↓\d+Mb ↑\d+Mb$/);
  assert.match(result.matrixLines[1], /^↓\d+MB ↑\d+MB$/);
});

test("internet status provider returns an offline slide when latency check fails", async () => {
  const provider = new InternetStatusProvider(
    async () => {
      throw new Error("network unavailable");
    },
    async () => ({ connectionType: "ethernet", interfaceName: "en5" })
  );

  const result = await provider.resolve({
    id: "internet-status",
    enabled: true,
    type: "internet-status"
  });

  assert.equal(result.internet.online, false);
  assert.equal(result.internet.connectionType, "ethernet");
  assert.deepEqual(result.readableLines, ["OFFLINE", "↓--Mb ↑--Mb"]);
  assert.deepEqual(result.matrixLines, ["OFFLINE", "↓--MB ↑--MB"]);
});

test("NBA live score falls back to the upcoming game when no game is live", async () => {
  const provider = new SportsProvider(async () => new Response(JSON.stringify({
    events: [{
      id: "nba-finals-next",
      name: "NBA Finals - Boston Celtics at Miami Heat",
      shortName: "BOS @ MIA",
      date: "2099-06-15T00:00:00.000Z",
      competitions: [{
        status: {
          type: {
            state: "pre",
            name: "STATUS_SCHEDULED",
            description: "Scheduled"
          }
        },
        competitors: [
          {
            homeAway: "away",
            team: { abbreviation: "BOS", displayName: "Boston Celtics" }
          },
          {
            homeAway: "home",
            team: { abbreviation: "MIA", displayName: "Miami Heat" }
          }
        ],
        notes: [{ headline: "NBA Finals" }]
      }]
    }]
  }), { status: 200, headers: { "content-type": "application/json" } }) as unknown as Response);

  const result = await provider.resolve({
    id: "nba-finals-live",
    enabled: true,
    type: "sports-live-score",
    league: "nba",
    mode: "finals"
  });

  assert.equal(result.game?.status, "scheduled");
  assert.equal(result.debug.fallback, "nba-live-score-to-next-game");
  assert.equal(result.readableLines.includes("NO NBA"), false);
  assert.equal(result.readableLines[1], "BOS AT MIA");
});

test("MLB next game can be scoped to the Miami Marlins", async () => {
  const provider = new SportsProvider(async () => new Response(JSON.stringify({
    events: [{
      id: "mlb-marlins-next",
      name: "Miami Marlins at Atlanta Braves",
      shortName: "MIA @ ATL",
      date: "2099-07-10T23:20:00.000Z",
      competitions: [{
        status: {
          type: {
            state: "pre",
            name: "STATUS_SCHEDULED",
            description: "Scheduled"
          }
        },
        competitors: [
          {
            homeAway: "away",
            team: { abbreviation: "MIA", displayName: "Miami Marlins" }
          },
          {
            homeAway: "home",
            team: { abbreviation: "ATL", displayName: "Atlanta Braves" }
          }
        ]
      }]
    }, {
      id: "mlb-other-next",
      name: "New York Mets at Philadelphia Phillies",
      shortName: "NYM @ PHI",
      date: "2099-07-10T22:05:00.000Z",
      competitions: [{
        status: {
          type: {
            state: "pre",
            name: "STATUS_SCHEDULED",
            description: "Scheduled"
          }
        },
        competitors: [
          {
            homeAway: "away",
            team: { abbreviation: "NYM", displayName: "New York Mets" }
          },
          {
            homeAway: "home",
            team: { abbreviation: "PHI", displayName: "Philadelphia Phillies" }
          }
        ]
      }]
    }]
  }), { status: 200, headers: { "content-type": "application/json" } }) as unknown as Response);

  const result = await provider.resolve({
    id: "miami-marlins-next",
    enabled: true,
    type: "sports-next-game",
    league: "mlb",
    team: "MIA"
  });

  assert.equal(result.game?.league, "MLB");
  assert.equal(result.game?.shortName, "MIA @ ATL");
  assert.equal(result.readableLines[0].startsWith("MLB "), true);
  assert.equal(result.readableLines[1], "MIA AT ATL");
  assert.equal(result.matrixLines[1], "MIA AT ATL");
});
