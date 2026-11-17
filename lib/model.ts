// Pre-Token Launch Radar valuation model and farming playbook engine (Node 22, zero dependencies).
//
// Reads the sealed DefiLlama protocol snapshot and produces a deterministic 200-row ranking of
// pre-token protocols: all 40 watchlist protocols (the $50M+ floor) plus the 160 strongest
// pre-token protocols below the floor (the early discovery radar). Protocols whose token already
// trades (non-null gecko_id, symbol, or mcap_usd) are excluded from the ranking and summarized
// separately with their live market metrics.

export interface SnapshotProtocol {
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
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface ModelConfig {
  version: string;
  base_multiple: number;
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  maturity_floor: number;
  maturity_span: number;
  maturity_horizon_days: number;
  default_age_days: number;
  chain_step: number;
  chain_max_extra: number;
  target_rows: number;
}

export const MODEL_CONFIG: ModelConfig = {
  version: 'helios-v2',
  base_multiple: 0.32,
  growth_weight: 0.45,
  growth_floor: -50,
  growth_cap: 150,
  maturity_floor: 0.65,
  maturity_span: 0.55,
  maturity_horizon_days: 900,
  default_age_days: 270,
  chain_step: 0.035,
  chain_max_extra: 8,
  target_rows: 200,
};

export interface FarmStepDetail {
  title: string;
  action: string;
  cost: string;
  time: string;
}

export interface ModelBreakdown {
  base_multiple: number;
  growth_pct: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  sector_multiplier: number;
  age_days: number | null;
}

export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: null;
  listed_at: string | null;
  gecko_id: null;
  symbol: null;
  token_status: 'pre-token';
  tier: 'watchlist' | 'early';
  age_days: number | null;
  implied_value_usd: number;
  model: ModelBreakdown;
  farm_steps: string[];
}

export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  tier: 'watchlist' | 'early';
  implied_value_usd: number;
  growth_multiplier: number;
  maturity_multiplier: number;
  chain_multiplier: number;
  sector_multiplier: number;
}

export interface LiveTokenRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConfig;
  counts: {
    total_protocols: number;
    pre_token_total: number;
    live_token_excluded: number;
    filtered_pre_token_excluded: number;
    watchlist_count: number;
    early_count: number;
    ranked_count: number;
  };
  rows: RadarRow[];
  live: LiveTokenRow[];
}

const DAY_MS = 86_400_000;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIX = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/i;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

const round4 = (n: number): number => Math.round(n * 10_000) / 10_000;

export function computeAgeDays(asOf: string, listedAt: string | null): number | null {
  if (!listedAt) return null;
  const end = Date.parse(`${asOf}T00:00:00Z`);
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isFinite(start)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/**
 * Sector valuation multiplier derived strictly from DefiLlama category classes (never protocol names).
 * Active fee-generating execution and credit protocols carry higher implied FDV/TVL multiples than
 * passive bridge or wrapper categories.
 */
export function sectorMultiplierFor(category: string | null): number {
  const c = (category ?? '').toLowerCase();
  if (
    c.includes('dex') ||
    c.includes('derivative') ||
    c.includes('perpetual') ||
    c.includes('prediction') ||
    c.includes('option') ||
    c.includes('synthetic') ||
    c.includes('launchpad')
  ) {
    return 1.25;
  }
  if (
    c.includes('lend') ||
    c.includes('cdp') ||
    c.includes('yield') ||
    c.includes('leveraged farm') ||
    c.includes('basis trading') ||
    c.includes('liquidity manager') ||
    c === 'farm'
  ) {
    return 1.15;
  }
  if (
    c.includes('curator') ||
    c.includes('allocator') ||
    c.includes('restak') ||
    c.includes('anchor btc') ||
    c.includes('decentralized btc')
  ) {
    return 1.08;
  }
  if (
    c === 'chain' ||
    c.includes('rwa') ||
    c.includes('insurance') ||
    c.includes('payment') ||
    c.includes('index')
  ) {
    return 1.05;
  }
  return 0.9;
}

/**
 * Five-factor valuation model from the snapshot's own figures:
 *   base       = tvl_usd * base_multiple (0.32)
 *   growthMult = 1 + (clamp(change_7d, -50, 150) / 100) * 0.45
 *   matMult    = 0.65 + (min(age_days ?? 270, 900) / 900) * 0.55
 *   chainMult  = 1 + min(max(chains.length, 1) - 1, 8) * 0.035
 *   sectorMult = sectorMultiplierFor(category)
 *   implied    = max(1, round(base * growthMult * matMult * chainMult * sectorMult))
 */
export function computeImpliedValue(
  p: SnapshotProtocol,
  asOf: string,
  cfg: ModelConfig = MODEL_CONFIG,
): { implied: number; breakdown: ModelBreakdown } {
  const age = computeAgeDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const clampedGrowth = Math.min(cfg.growth_cap, Math.max(cfg.growth_floor, rawGrowth));
  const growthMult = round4(1 + (clampedGrowth / 100) * cfg.growth_weight);

  const effectiveAge = Math.min(cfg.maturity_horizon_days, Math.max(0, age ?? cfg.default_age_days));
  const maturityMult = round4(cfg.maturity_floor + (effectiveAge / cfg.maturity_horizon_days) * cfg.maturity_span);

  const chainCount = Math.max(1, Array.isArray(p.chains) ? p.chains.length : 1);
  const extraChains = Math.min(cfg.chain_max_extra, chainCount - 1);
  const chainMult = round4(1 + extraChains * cfg.chain_step);

  const sectorMult = round4(sectorMultiplierFor(p.category));

  const base = p.tvl_usd * cfg.base_multiple;
  const implied = Math.max(1, Math.round(base * growthMult * maturityMult * chainMult * sectorMult));

  return {
    implied,
    breakdown: {
      base_multiple: cfg.base_multiple,
      growth_pct: round4(clampedGrowth),
      growth_multiplier: growthMult,
      maturity_multiplier: maturityMult,
      chain_multiplier: chainMult,
      sector_multiplier: sectorMult,
      age_days: age,
    },
  };
}

export function isPreToken(p: SnapshotProtocol): boolean {
  return p.gecko_id === null && p.symbol === null && p.mcap_usd === null;
}

export function isCleanCandidate(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (p.category === 'CEX') return false;
  if (VERSION_SUFFIX.test(p.name)) return false;
  if (EXCHANGE_PREFIX.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  return true;
}

function gasProfileFor(chain: string): { setupGas: string; actionGas: string; weeklyGas: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum' || c === 'bitcoin') {
    return { setupGas: '$6-$12 L1 gas', actionGas: '$8-$15 L1 gas', weeklyGas: '$4-$8/wk L1 gas' };
  }
  return { setupGas: '$0.15-$0.60 network gas', actionGas: '$0.25-$0.90 network gas', weeklyGas: '$0.20-$0.50/wk gas' };
}

function recommendedCapital(tvlUsd: number): number {
  if (tvlUsd >= 1_000_000_000) return 500;
  if (tvlUsd >= 250_000_000) return 300;
  if (tvlUsd >= 50_000_000) return 200;
  if (tvlUsd >= 15_000_000) return 120;
  return 80;
}

function targetHoldDays(ageDays: number | null): number {
  if (ageDays === null) return 45;
  if (ageDays < 120) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

export function buildFarmSteps(p: SnapshotProtocol, ageDays: number | null): FarmStepDetail[] {
  const primaryChain = p.chains.length > 0 ? p.chains[0]! : 'Ethereum';
  const secondaryChain = p.chains.length > 1 ? p.chains[1]! : null;
  const gas = gasProfileFor(primaryChain);
  const cap = recommendedCapital(p.tvl_usd);
  const hold = targetHoldDays(ageDays);
  const cat = (p.category ?? 'DeFi').toLowerCase();
  const catLabel = p.category ?? 'DeFi';

  let deployAction = `Supply $${cap} of USDC or native collateral into ${p.name}'s core ${catLabel} contracts on ${primaryChain} and retain the vault receipt tokens in the same wallet.`;
  if (cat.includes('lend') || cat.includes('cdp')) {
    deployAction = `Deposit $${cap} of USDC or blue-chip collateral into ${p.name}'s lending market on ${primaryChain}, then borrow 30-40% against it to register both supply and borrow utilization.`;
  } else if (cat.includes('dex') || cat.includes('liquidity manager') || cat === 'farm' || cat.includes('leveraged farm')) {
    deployAction = `Provide $${cap} of two-sided liquidity into ${p.name}'s deepest active pool on ${primaryChain}, keeping the LP position within the active fee-earning range.`;
  } else if (cat.includes('curator') || cat.includes('allocator') || cat.includes('yield')) {
    deployAction = `Allocate $${cap} into ${p.name}'s highest-TVL curated strategy vault on ${primaryChain} and hold the yield-bearing vault shares without transferring them out.`;
  } else if (cat.includes('derivative') || cat.includes('perpetual') || cat.includes('basis') || cat.includes('prediction')) {
    deployAction = `Fund ${p.name}'s margin account on ${primaryChain} with $${cap} USDC and execute at least two low-leverage ($${cap * 2} notional) hedged positions to log maker/taker volume.`;
  } else if (cat.includes('restak') || cat.includes('staking') || cat.includes('btc')) {
    deployAction = `Stake $${cap} of native collateral through ${p.name} on ${primaryChain} and hold the liquid restaked or staked receipt asset in your wallet to accrue epoch points.`;
  } else if (cat.includes('bridge')) {
    const dest = secondaryChain ?? 'Arbitrum';
    deployAction = `Bridge $${cap} of USDC or ETH through ${p.name} between ${primaryChain} and ${dest}, plus supply a small liquidity buffer into ${p.name}'s bridge pool if open.`;
  } else if (cat.includes('rwa')) {
    deployAction = `Mint or acquire $${cap} of ${p.name}'s tokenized yield instrument on ${primaryChain} and hold the asset across monthly yield distribution checkpoints.`;
  }

  const cadenceAction = secondaryChain
    ? `Execute one cross-chain interaction on ${p.name} between ${primaryChain} and ${secondaryChain} every 7-10 days so your address qualifies on multi-chain usage tiers.`
    : `Perform one recurring on-chain interaction on ${p.name} (${primaryChain}) every 7 days—such as compounding yield, adjusting collateral, or rolling an epoch position.`;

  const tenureNote = ageDays !== null ? `${ageDays} days since ${p.listed_at}` : 'unlisted start date';

  return [
    {
      title: 'Dedicated Wallet & Gas Provisioning',
      action: `Fund a dedicated non-custodial wallet on ${primaryChain} with $${cap} principal plus gas reserves specifically for farming ${p.name} (${catLabel}).`,
      cost: `$${cap} principal + ${gas.setupGas}`,
      time: '10 mins setup',
    },
    {
      title: 'Core Protocol Liquidity Deployment',
      action: deployAction,
      cost: `$${cap} active deposit + ${gas.actionGas}`,
      time: '15 mins execution',
    },
    {
      title: secondaryChain ? 'Multi-Chain Footprint Expansion' : 'Weekly Active Cadence',
      action: cadenceAction,
      cost: gas.weeklyGas,
      time: '10 mins / week',
    },
    {
      title: 'Time-Weighted Snapshot Retention',
      action: `Maintain the $${cap} position on ${p.name} continuously for at least ${hold} days (${tenureNote}) to clear time-weighted average balance (TWAB) anti-sybil filters.`,
      cost: `$${cap} opportunity lock ($0 extra fee)`,
      time: `${hold} days hold`,
    },
    {
      title: 'Epoch & Points Attestation Check',
      action: `Verify accrued points, vault share snapshots, or governance badges on ${p.name}'s official ${primaryChain} interface once per bi-weekly epoch without revoking active approvals.`,
      cost: '$0 read-only check',
      time: '5 mins / bi-weekly',
    },
    {
      title: 'Utilization Watch & Post-Snapshot Unwind',
      action: `Monitor ${p.name}'s pool utilization and 7d TVL trend (${p.change_7d !== null ? `${p.change_7d >= 0 ? '+' : ''}${p.change_7d.toFixed(2)}%` : 'unreported'}) on ${primaryChain}, then unwind or rotate principal after the TGE snapshot cutoff.`,
      cost: gas.actionGas,
      time: '10 mins unwind',
    },
  ];
}

export function formatFarmStep(step: FarmStepDetail): string {
  const raw = `${step.title}: ${step.action} Cost: ${step.cost}. Time: ${step.time}.`.trim();
  if (raw.length > 600) return `${raw.slice(0, 597)}...`;
  if (raw.length < 20) return `${raw} Maintain position on main chain.`;
  return raw;
}

export function buildRadar(snapshot: Snapshot, cfg: ModelConfig = MODEL_CONFIG): { board: BoardRow[]; radar: RadarData } {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watchlistSet = new Set(snapshot.watchlist);
  const selected = new Map<string, SnapshotProtocol>();

  // 1. Include all 40 watchlist protocols (the required floor).
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p) selected.set(slug, p);
  }

  // 2. Score pre-token protocols below the floor and pick the strongest to reach 200 rows.
  const needed = Math.max(0, cfg.target_rows - selected.size);
  const cleanBelowFloor = snapshot.protocols
    .filter((p) => !selected.has(p.slug) && p.tvl_usd < snapshot.floor_usd && isCleanCandidate(p))
    .map((p) => ({ p, score: computeImpliedValue(p, snapshot.as_of, cfg).implied }))
    .sort((a, b) => b.score - a.score || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  for (const item of cleanBelowFloor.slice(0, needed)) {
    selected.set(item.p.slug, item.p);
  }

  // Fallback if snapshot has fewer than needed clean candidates: allow any pre-token non-CEX protocol.
  if (selected.size < cfg.target_rows) {
    const fallback = snapshot.protocols
      .filter((p) => !selected.has(p.slug) && isPreToken(p) && p.category !== 'CEX')
      .map((p) => ({ p, score: computeImpliedValue(p, snapshot.as_of, cfg).implied }))
      .sort((a, b) => b.score - a.score || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));
    for (const item of fallback) {
      if (selected.size >= cfg.target_rows) break;
      selected.set(item.p.slug, item.p);
    }
  }

  // 3. Score and rank all chosen protocols by implied_value_usd descending, tie-breaking by slug.
  const scored = [...selected.values()].map((p) => {
    const { implied, breakdown } = computeImpliedValue(p, snapshot.as_of, cfg);
    return { p, implied, breakdown };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));

  const board: BoardRow[] = scored.map((item, idx) => {
    const steps = buildFarmSteps(item.p, item.breakdown.age_days).map(formatFarmStep);
    return {
      rank: idx + 1,
      slug: item.p.slug,
      name: item.p.name,
      category: item.p.category,
      chains: item.p.chains,
      tvl_usd: item.p.tvl_usd,
      change_7d: item.p.change_7d,
      mcap_usd: null,
      listed_at: item.p.listed_at,
      gecko_id: null,
      symbol: null,
      token_status: 'pre-token',
      tier: watchlistSet.has(item.p.slug) ? 'watchlist' : 'early',
      age_days: item.breakdown.age_days,
      implied_value_usd: item.implied,
      model: item.breakdown,
      farm_steps: steps,
    };
  });

  // 4. Summarize live-token protocols (excluded from ranking because their token already trades).
  const allPreToken = snapshot.protocols.filter(isPreToken);
  const allLiveToken = snapshot.protocols.filter((p) => !isPreToken(p));
  const topLive: LiveTokenRow[] = allLiveToken
    .filter((p) => p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, 30)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));

  const radarRows: RadarRow[] = board.map((r) => ({
    rank: r.rank,
    slug: r.slug,
    name: r.name,
    category: r.category,
    chains: r.chains,
    tvl_usd: r.tvl_usd,
    change_7d: r.change_7d,
    listed_at: r.listed_at,
    age_days: r.age_days,
    tier: r.tier,
    implied_value_usd: r.implied_value_usd,
    growth_multiplier: r.model.growth_multiplier,
    maturity_multiplier: r.model.maturity_multiplier,
    chain_multiplier: r.model.chain_multiplier,
    sector_multiplier: r.model.sector_multiplier,
  }));

  const watchlistCount = board.filter((r) => r.tier === 'watchlist').length;
  const earlyCount = board.length - watchlistCount;

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model: cfg,
    counts: {
      total_protocols: snapshot.protocols.length,
      pre_token_total: allPreToken.length,
      live_token_excluded: allLiveToken.length,
      filtered_pre_token_excluded: Math.max(0, allPreToken.length - board.length),
      watchlist_count: watchlistCount,
      early_count: earlyCount,
      ranked_count: board.length,
    },
    rows: radarRows,
    live: topLive,
  };

  return { board, radar };
}

export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Record<string, unknown>;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('snapshot.json must be a JSON object');
  }
  if (typeof raw.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.as_of)) {
    throw new Error('snapshot.json requires a valid as_of date');
  }
  if (typeof raw.source !== 'string') {
    throw new Error('snapshot.json requires a source string');
  }
  if (typeof raw.floor_usd !== 'number' || !Number.isSafeInteger(raw.floor_usd) || raw.floor_usd <= 0) {
    throw new Error('snapshot.json requires a positive integer floor_usd');
  }
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot.json requires protocols and watchlist arrays');
  }

  const protocols: SnapshotProtocol[] = raw.protocols.map((entry, idx) => {
    const p = entry as Record<string, unknown>;
    if (!p || typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error(`Invalid protocol record at index ${idx}`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });

  return {
    as_of: raw.as_of,
    source: raw.source,
    floor_usd: raw.floor_usd,
    protocols,
    watchlist: (raw.watchlist as unknown[]).filter((s): s is string => typeof s === 'string'),
  };
}

export function validateBoard(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board row count ${board.length} outside 100..4000`;
  }
  const slugSet = new Set<string>();
  const validSlugs = new Set(snapshot.protocols.map((p) => p.slug));
  for (let i = 0; i < board.length; i++) {
    const row = board[i]!;
    if (row.rank !== i + 1) return `expected rank ${i + 1}, got ${row.rank}`;
    if (!validSlugs.has(row.slug)) return `unknown slug ${row.slug}`;
    if (slugSet.has(row.slug)) return `duplicate slug ${row.slug}`;
    slugSet.add(row.slug);
    if (!Number.isSafeInteger(row.implied_value_usd) || row.implied_value_usd <= 0 || row.implied_value_usd > 100_000_000_000_000) {
      return `invalid implied_value_usd ${row.implied_value_usd} for ${row.slug}`;
    }
    if (i > 0 && row.implied_value_usd > board[i - 1]!.implied_value_usd) {
      return `implied_value_usd rose at rank ${row.rank}`;
    }
    if (!Array.isArray(row.farm_steps) || row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `invalid farm_steps count for ${row.slug}`;
    }
    for (const step of row.farm_steps) {
      const trimmed = step.trim();
      if (trimmed.length < 20 || trimmed.length > 600) {
        return `farm step length ${trimmed.length} outside 20..600 for ${row.slug}`;
      }
    }
  }
  for (const wlSlug of snapshot.watchlist) {
    if (!slugSet.has(wlSlug)) return `missing watchlist slug ${wlSlug}`;
  }
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return 'all rows share identical implied_value_usd';
  }
  return null;
}

export function serializeDataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
