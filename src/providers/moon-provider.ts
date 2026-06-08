import { DisplayItemConfig } from "../rotation/types.js";
import { fitDisplayLine, sanitizeDisplayLines } from "../matrix/text-sanitizer.js";

const SYNODIC_MONTH_DAYS = 29.530588853;
const KNOWN_NEW_MOON_UTC = Date.UTC(2000, 0, 6, 18, 14);

export class MoonProvider {
  resolve(_config: DisplayItemConfig, now = new Date()) {
    const phase = calculateMoonPhase(now);
    const days = Math.ceil(phase.daysUntilFullMoon);
    const dayLabel = days === 0 ? "TONIGHT" : `${days}D`;
    const illuminationPercent = Math.round(phase.illumination * 100);
    const lines = sanitizeDisplayLines([`MOON ${illuminationPercent}%`, `FULL IN ${dayLabel}`]);

    return {
      moon: phase,
      readableLines: lines,
      matrixLines: lines.map((line) => fitDisplayLine(line, 12)),
      debug: {
        phaseName: phase.phaseName,
        illumination: phase.illumination,
        waxing: phase.waxing,
        daysUntilFullMoon: phase.daysUntilFullMoon
      }
    };
  }
}

function calculateMoonPhase(now: Date) {
  const daysSinceKnownNewMoon = (now.getTime() - KNOWN_NEW_MOON_UTC) / 86_400_000;
  const age = positiveModulo(daysSinceKnownNewMoon, SYNODIC_MONTH_DAYS);
  const fullMoonAge = SYNODIC_MONTH_DAYS / 2;
  const daysUntilFullMoon = age <= fullMoonAge ? fullMoonAge - age : SYNODIC_MONTH_DAYS - age + fullMoonAge;
  const illumination = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_MONTH_DAYS)) / 2;

  return {
    phaseName: phaseName(age),
    illumination,
    waxing: age < fullMoonAge,
    daysUntilFullMoon
  };
}

function phaseName(age: number): string {
  const eighth = SYNODIC_MONTH_DAYS / 8;
  if (age < eighth * 0.5 || age >= eighth * 7.5) return "New Moon";
  if (age < eighth * 1.5) return "Waxing Crescent";
  if (age < eighth * 2.5) return "First Quarter";
  if (age < eighth * 3.5) return "Waxing Gibbous";
  if (age < eighth * 4.5) return "Full Moon";
  if (age < eighth * 5.5) return "Waning Gibbous";
  if (age < eighth * 6.5) return "Last Quarter";
  return "Waning Crescent";
}

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}
