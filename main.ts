import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
const taus = [0.05, 0.25, 0.5, 0.75, 0.95];
const z = [-1.644854, -0.67449, 0, 0.67449, 1.644854];
const clamp = (v: number): number => Math.round(Math.max(0, Math.min(1, v)) * 1e6) / 1e6;

type Market = { id: string; prices: number[] };
type CaseInput = { case: string; horizon_minutes: number; quantiles: number[]; markets: Market[] };

// Estimate one-minute movement from recent squared price changes. The longer
// window stabilizes quiet markets; the short window responds to new activity.
function volatility(prices: number[]): number {
  const last = prices.length - 1;
  const rms = (count: number): number => {
    const from = Math.max(1, prices.length - count);
    let sum = 0;
    for (let i = from; i <= last; i++) {
      const d = prices[i] - prices[i - 1];
      sum += d * d;
    }
    return Math.sqrt(sum / Math.max(1, last - from + 1));
  };
  const recent = rms(120);
  const background = rms(1440);
  // A 2:1 blend of recent and background variance, with modest floor/cap.
  const blended = Math.sqrt((2 * recent * recent + background * background) / 3);
  return 0.2 * Math.max(0.00035, Math.min(0.01, blended));
}

function forecast(m: Market, horizon: number): number[][] {
  if (!m.prices.length) throw new Error(`market ${m.id} has no prices`);
  const x = m.prices[m.prices.length - 1];
  const sigma = volatility(m.prices);
  const out: number[][] = [];
  for (let h = 1; h <= horizon; h++) {
    const row = z.map((v) => clamp(x + v * sigma * Math.sqrt(h)));
    // Clamping preserves order, but explicitly enforce it against roundoff.
    for (let j = 1; j < row.length; j++) row[j] = Math.max(row[j], row[j - 1]);
    out.push(row);
  }
  return out;
}

mkdirSync(outputDir, { recursive: true });
for (const file of readdirSync(inputDir).filter((f) => f.endsWith('.in')).sort()) {
  const c = JSON.parse(readFileSync(join(inputDir, file), 'utf8')) as CaseInput;
  if (c.quantiles.length !== 5 || c.quantiles.some((t, i) => t !== taus[i])) throw new Error('unexpected quantile schema');
  if (!Number.isInteger(c.horizon_minutes) || c.horizon_minutes < 1) throw new Error('invalid horizon');
  const forecasts = c.markets.map((m) => ({ id: m.id, q: forecast(m, c.horizon_minutes) }));
  writeFileSync(join(outputDir, `${c.case}.out`), `${JSON.stringify({ forecasts })}\n`);
}
