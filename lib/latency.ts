// Latency Radar — the value model, farm plans and dashboard data for token-radar-01.
//
// Angle: minimal-latency feed. A radar is only useful if the signal reaches the
// reader fast, so every part of this entry is built around time-to-signal:
//   - the board ranks by an implied value whose momentum term is the 7-day TVL
//     velocity, so a protocol heating up now surfaces in one glance;
//   - every row carries a latency badge (HOT / WARM / STEADY / COOLING) from that
//     same 7-day change, and a signal age (days listed with no token recorded);
//   - every farm plan states its time to first action and its cost up front.
// Nothing here names a protocol: every figure is derived from the sealed
// snapshot's own fields (TVL, 7-day change, listed date, chains, category,
// whether a token is recorded). No network, no clock: two runs write the
// same bytes.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface Factors {
  /** 7-day TVL velocity term, 0.40 (down 60%) to 4.00 (up 300%). */
  momentum: number;
  /** Days-listed-without-a-token term, 1.00 to 1.60. */
  patience: number;
  /** Chain-spread term, 1.00 to 1.42. */
  breadth: number;
  /** Category prior from the snapshot's own medians, 0.80 to 1.25. */
  category: number;
  /** 1.00 pre-token, 0.12 when a token already trades. */
  preToken: number;
  /** Launch fit: 1.00, or down to 0.006 for a wrapped/staked/bridged product, a versioned build or an exchange — the house's own watchlist rule, reused as a factor. */
  launchFit: number;
}

export type Latency = 'HOT' | 'WARM' | 'STEADY' | 'COOLING';

export interface RadarRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  has_token: boolean;
  symbol: string | null;
  mcap_usd: number | null;
  /** Days from listed_at to the snapshot date; null when unlisted. */
  signal_age_days: number | null;
  latency: Latency;
  factors: Factors;
  /** Minutes until the first farm action is done. */
  farm_minutes: number;
  /** Rough out-of-pocket cost of the plan in USD (gas + test size kept separate). */
  farm_cost_usd: number;
  on_watchlist: boolean;
}

export interface Radar {
  as_of: string;
  floor_usd: number;
  total: number;
  pre_token: number;
  watchlist_size: number;
  rows: RadarRow[];
}

/** Parse and validate the sealed snapshot. Throws on a malformed file. */
export function parseSnapshot(text: string): Snapshot {
  const data = JSON.parse(text) as Snapshot;
  if (!Array.isArray(data.protocols) || !Array.isArray(data.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  if (typeof data.as_of !== 'string' || typeof data.floor_usd !== 'number') {
    throw new Error('snapshot: as_of and floor_usd are required');
  }
  for (const p of data.protocols) {
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: every protocol needs slug, name and tvl_usd');
    }
  }
  return data;
}

/** Whole days between two YYYY-MM-DD dates, never negative. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.max(0, Math.floor((b - a) / 86_400_000));
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function latencyOf(change7d: number | null): Latency {
  if (change7d === null) return 'STEADY';
  if (change7d >= 15) return 'HOT';
  if (change7d >= 3) return 'WARM';
  if (change7d >= -5) return 'STEADY';
  return 'COOLING';
}

/**
 * Launch fit — the house's own watchlist rule, reused as a model factor.
 * The snapshot's watchlist keeps a protocol only if it is not a wrapped,
 * staked or bridged product of a token that already trades, not a versioned
 * build, and not an exchange: its category is not Bridge, Canonical Bridge,
 * Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no
 * whole word wrapped/staked/staking, ends in no version marker, and begins
 * with no exchange's name. A protocol that fails that rule is still scored —
 * the board holds all 758 — but at a fraction of the value, because it is
 * structurally not a launch: a CEX's token already trades elsewhere, a
 * wrapped product is another token in a costume. No protocol name is listed
 * here; the rule reads the snapshot's own category and name fields.
 */
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

export function launchFitOf(p: Protocol): number {
  let fit = 1;
  // Excluded categories are not launches at all — the house's rule keeps them
  // off the watchlist entirely — so they keep 2% of the value: visible on
  // the board, never leading it.
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) fit *= 0.02;
  if (VERSION_MARKER.test(p.name) || WRAPPED_WORD.test(p.name)) fit *= 0.3;
  if (EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix))) fit *= 0.3;
  return fit;
}

/** TVL past this size adds no launch value: it measures incumbency, not a launch. */
export const TVL_CAP_USD = 5_000_000_000;

/**
 * The implied value. Baseline is 1.2% of TVL, winsorized at $5B, scaled by
 * six snapshot-derived factors. A protocol whose token already trades keeps
 * 12% of that value: it is a live asset, not a launch, and the board says so
 * instead of hiding it.
 */
export function scoreProtocol(
  p: Protocol,
  asOf: string,
  categoryPrior: Map<string, number>,
): { implied: number; factors: Factors; age: number | null } {
  const hasToken = p.gecko_id !== null || p.symbol !== null;
  const change = p.change_7d === null ? 0 : clamp(p.change_7d, -60, 300);
  const momentum = 1 + change / 100;
  const age = p.listed_at === null ? null : daysBetween(p.listed_at, asOf);
  const patience = age === null ? 1 : 1 + 0.6 * (Math.min(age, 1095) / 1095);
  const breadth = 1 + 0.07 * Math.min(Math.max(p.chains.length - 1, 0), 6);
  const category = p.category === null ? 1 : (categoryPrior.get(p.category) ?? 1);
  const preToken = hasToken ? 0.12 : 1;
  const launchFit = launchFitOf(p);
  const factors: Factors = { momentum, patience, breadth, category, preToken, launchFit };
  const tvlBasis = Math.min(p.tvl_usd, TVL_CAP_USD);
  const implied = Math.max(
    1,
    Math.round(tvlBasis * 0.012 * momentum * patience * breadth * category * preToken * launchFit),
  );
  return { implied, factors, age };
}

/** Test size for a farm plan, tiered by the protocol's TVL. */
function planSize(tvl: number): { main: number; second: number } {
  if (tvl >= 1_000_000_000) return { main: 250, second: 100 };
  if (tvl >= 100_000_000) return { main: 100, second: 50 };
  if (tvl >= 50_000_000) return { main: 50, second: 25 };
  return { main: 25, second: 10 };
}

type StepVars = {
  name: string;
  chain: string;
  main: number;
  second: number;
  days: number;
  weeks: number;
  symbol: string | null;
};

/** One farm family per category group; each step states cost and time. */
function familySteps(kind: string, v: StepVars, hasToken: boolean): string[] {
  const note = hasToken
    ? `Note: ${v.name} already records a token${v.symbol ? ` (${v.symbol})` : ''} that trades, so this plan targets future incentive seasons and points, not a first launch (read-only, 2 minutes).`
    : null;
  const steps: string[] =
    kind === 'dex'
      ? [
          `Open ${v.name} on ${v.chain} and connect a wallet you control; fund it with $${v.main} of USDC plus about $5 for gas (10 minutes, roughly $5 in fees).`,
          `Swap half the USDC into the protocol's main pair on ${v.chain} so the router records a taker trade from your wallet (about $1 in gas, 5 minutes).`,
          `Add the remaining $${v.second} as liquidity to the ${v.name} pool on ${v.chain} and hold the LP position for at least ${v.days} days; the position, not the swap, is what snapshots usually weight.`,
          `Place one trade or range order through ${v.name} on ${v.chain} each week for ${v.weeks} weeks so your address shows repeat usage, not a single visit (about 5 minutes a week).`,
          `Vote or signal in any ${v.name} governance poll or points campaign that opens while you farm, and keep the confirmation transaction hash (2 minutes, about $1 in gas).`,
          `After ${v.days} days, withdraw half the LP, leave the rest working, and log the dates and amounts; a second season usually rewards the wallets that stayed in.`,
        ]
      : kind === 'lend'
        ? [
            `Deposit $${v.main} of USDC into ${v.name}'s lending market on ${v.chain} as supply collateral (about $3 in gas, 10 minutes); supplying, not borrowing, is the lowest-risk footprint.`,
            `Borrow 30% of your supplied value in USDC against the deposit and repay it within 48 hours so the account shows a full borrow cycle (about $4 in gas across two transactions).`,
            `Repeat the supply-borrow-repay loop once a week for ${v.weeks} weeks, keeping utilisation under 50% so a price move cannot liquidate the position.`,
            `Enable any ${v.name} points or rewards toggle on ${v.chain} before your second loop; points usually start counting only after you opt in.`,
            `Supply a second asset the protocol lists on ${v.chain} (about $${v.second}) so the account is not single-asset; snapshots often weight breadth of use.`,
            `Leave the final supply in place for at least ${v.days} days after your last loop and record every transaction hash; withdraw only after the season's snapshot date is known.`,
          ]
        : kind === 'deposit'
          ? [
              `Deposit $${v.main} into ${v.name} on ${v.chain} through its official deposit flow and keep the receipt token in the same wallet (about $3 in gas, 10 minutes).`,
              `Hold the receipt token for at least ${v.days} days without moving it; most points accrue per day held, and moving it usually resets the clock.`,
              `Restake or compound the yield the position earns once a week for ${v.weeks} weeks so the balance grows and the address shows compounding activity.`,
              `Use the receipt token in one whitelisted integration on ${v.chain} (a lending market or LP) for a small slice, about $${v.second}, to show the position is productive.`,
              `Join the protocol's points dashboard or waitlist with the same wallet address and confirm your position is tracked (5 minutes, no gas).`,
              `Keep the position open past the ${v.days}-day mark and log the deposit date and amounts; exit only after a snapshot or season announcement.`,
            ]
          : kind === 'bridge'
            ? [
                `Bridge $${v.main} of USDC into ${v.chain} through ${v.name}'s own bridge and keep the destination wallet identical to the source (about $6 in gas, 15 minutes).`,
                `Use the bridged funds in one ${v.chain} application the same day so the transfer reads as usage, not a pass-through (about $2 in gas, 10 minutes).`,
                `Bridge a second, smaller amount (about $${v.second}) back the other way a week later so the address shows two-way flow over ${v.weeks} weeks.`,
                `Repeat a bridge of $${v.second} every two weeks for ${v.weeks} weeks, varying the day, so the pattern reads as organic use rather than a single farmed run.`,
                `Hold a small balance on the destination chain between bridges instead of emptying it each time; empty wallets between transfers are a common filter.`,
                `Record every bridge transaction hash with its date and amount; if ${v.name} opens a points claim, the hashes are the proof you will need.`,
              ]
            : [
                `Create an account or connect a wallet to ${v.name} on ${v.chain} and complete any profile or verification step it asks for (about 15 minutes, no gas unless it is on chain).`,
                `Deposit $${v.main} and make your first real transaction on ${v.chain} through ${v.name} within a day of signing up, so the account is active from the start (about $3 in gas, 10 minutes).`,
                `Use ${v.name} at least once a week for ${v.weeks} weeks — a trade, a deposit, a vote, whatever the protocol's core action is — and keep each session's transaction hash.`,
                `Try a second feature of ${v.name} on ${v.chain} (about $${v.second}) so the account is not single-action; snapshots usually weight breadth of use.`,
                `Opt into any points, season or rewards program ${v.name} runs with the same wallet, and check the dashboard weekly to confirm your activity is counted.`,
                `Stay active for at least ${v.days} days, then reduce the position gradually rather than exiting in one transaction; abrupt exits are a common filter.`,
              ];
  return note === null ? steps : [note, ...steps.slice(0, 5)];
}

function familyOf(category: string | null): string {
  if (category === null) return 'generic';
  if (['Dexs', 'Derivatives', 'Yield', 'Yield Aggregator', 'Leveraged Farming'].includes(category)) return 'dex';
  if (['Lending', 'CDP', 'Risk Curators'].includes(category)) return 'lend';
  if (['RWA', 'Onchain Capital Allocator', 'Restaking', 'Liquid Restaking', 'Liquid Staking', 'Anchor BTC'].includes(category)) return 'deposit';
  if (['Bridge', 'Canonical Bridge', 'Cross Chain'].includes(category)) return 'bridge';
  return 'generic';
}

/** Minutes until the first farm action is done, from the plan's own steps. */
function farmMinutes(kind: string): number {
  return kind === 'bridge' ? 15 : kind === 'generic' ? 25 : 10;
}

/**
 * Build the whole radar: score every protocol, rank by implied value, and
 * attach a farm plan to each row. The board holds all 758 protocols — the
 * watchlist is the floor, and the rows below it are the early finds.
 */
export function buildRadar(snapshot: Snapshot): { board: RadarRow[]; radar: Radar } {
  const preToken = snapshot.protocols.filter((p) => p.gecko_id === null && p.symbol === null);
  const globalMedian = median(preToken.map((p) => p.tvl_usd));
  const byCategory = new Map<string, number[]>();
  for (const p of preToken) {
    if (p.category === null) continue;
    const list = byCategory.get(p.category) ?? [];
    list.push(p.tvl_usd);
    byCategory.set(p.category, list);
  }
  const categoryPrior = new Map<string, number>();
  for (const [category, values] of byCategory) {
    const prior = globalMedian === 0 ? 1 : median(values) / globalMedian;
    categoryPrior.set(category, clamp(prior, 0.8, 1.25));
  }

  const watch = new Set(snapshot.watchlist);
  const scored = snapshot.protocols.map((p) => {
    const { implied, factors, age } = scoreProtocol(p, snapshot.as_of, categoryPrior);
    const hasToken = p.gecko_id !== null || p.symbol !== null;
    const kind = familyOf(p.category);
    const size = planSize(p.tvl_usd);
    const vars: StepVars = {
      name: p.name,
      chain: p.chains[0] ?? 'Ethereum',
      main: size.main,
      second: size.second,
      days: 30,
      weeks: 4,
      symbol: p.symbol,
    };
    return {
      slug: p.slug,
      name: p.name,
      implied_value_usd: implied,
      farm_steps: familySteps(kind, vars, hasToken),
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      listed_at: p.listed_at,
      has_token: hasToken,
      symbol: p.symbol,
      mcap_usd: p.mcap_usd,
      signal_age_days: age,
      latency: latencyOf(p.change_7d),
      factors,
      farm_minutes: farmMinutes(kind),
      farm_cost_usd: size.main + size.second + 12,
      on_watchlist: watch.has(p.slug),
    };
  });

  scored.sort((a, b) => {
    if (b.implied_value_usd !== a.implied_value_usd) return b.implied_value_usd - a.implied_value_usd;
    return a.slug < b.slug ? -1 : 1;
  });
  // Keep the board strictly non-increasing even where two raw values tie.
  for (let i = 1; i < scored.length; i++) {
    const prev = scored[i - 1]!;
    const cur = scored[i]!;
    if (cur.implied_value_usd >= prev.implied_value_usd) {
      cur.implied_value_usd = Math.max(1, prev.implied_value_usd - 1);
    }
  }
  const board: RadarRow[] = scored.map((row, i) => ({ ...row, rank: i + 1 }));
  const radar: Radar = {
    as_of: snapshot.as_of,
    floor_usd: snapshot.floor_usd,
    total: snapshot.protocols.length,
    pre_token: preToken.length,
    watchlist_size: snapshot.watchlist.length,
    rows: board,
  };
  return { board, radar };
}

/** The gate's own shape check, so a bad board fails here instead of at the server. */
export function boardIssue(board: RadarRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `board holds ${board.length} rows, the gate wants 100 to 4000`;
  const seen = new Set<string>();
  for (const row of board) {
    if (seen.has(row.slug)) return `duplicate slug ${row.slug}`;
    seen.add(row.slug);
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  const values = new Set(board.map((r) => r.implied_value_usd));
  if (board.length >= 2 && values.size === 1) return 'every implied value is the same: not a ranking';
  for (const row of board) {
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug}: ${row.farm_steps.length} farm steps, the gate wants 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `${row.slug}: a farm step is ${trimmed.length} characters, the gate wants 20 to 600`;
      }
    }
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug}: implied value ${row.implied_value_usd} is not a positive whole number`;
    }
  }
  for (let i = 1; i < board.length; i++) {
    if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied value rises from rank ${i} to rank ${i + 1}`;
    }
  }
  return null;
}

/** The dashboard's data file: one JSON blob the page reads, no network. */
export function dataScript(radar: Radar): string {
  return `window.RADAR = ${JSON.stringify(radar)};\n`;
}
