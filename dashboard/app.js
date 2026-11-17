// Helios Token Radar — Offline Client Application
// Reads window.RADAR (generated deterministically by main.ts into ../data.js), verifies the
// five-factor valuation model in the browser, and renders the sortable/filterable pre-token board,
// the excluded live-token comparison table, and the per-protocol detail & farming drawer.
(function () {
  'use strict';

  var DATA = window.RADAR;
  var root = document.getElementById('radar-app');
  if (!DATA || !root) return;

  var state = {
    filter: '',
    category: 'all',
    chain: 'all',
    tier: 'all', // 'all' | 'watchlist' | 'early' | 'live'
    sort: 'implied',
    dir: -1,
    slug: null
  };

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }

  function fmtExactUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'unreported';
    return (n >= 0 ? '+' : '') + n.toFixed(2) + '%';
  }

  function fmtAge(days, listedAt) {
    if (days === null || days === undefined) return 'unlisted (~270d std)';
    if (days >= 365) return (days / 365).toFixed(1) + 'y (' + days + 'd)';
    return days + 'd' + (listedAt ? ' (' + listedAt + ')' : '');
  }

  function round4(n) {
    return Math.round(n * 10000) / 10000;
  }

  // Exact browser mirror of lib/model.ts sectorMultiplierFor & computeImpliedValue
  function sectorMultiplierFor(category) {
    var c = (category || '').toLowerCase();
    if (c.indexOf('dex') >= 0 || c.indexOf('derivative') >= 0 || c.indexOf('perpetual') >= 0 || c.indexOf('prediction') >= 0 || c.indexOf('option') >= 0 || c.indexOf('synthetic') >= 0 || c.indexOf('launchpad') >= 0) return 1.25;
    if (c.indexOf('lend') >= 0 || c.indexOf('cdp') >= 0 || c.indexOf('yield') >= 0 || c.indexOf('leveraged farm') >= 0 || c.indexOf('basis trading') >= 0 || c.indexOf('liquidity manager') >= 0 || c === 'farm') return 1.15;
    if (c.indexOf('curator') >= 0 || c.indexOf('allocator') >= 0 || c.indexOf('restak') >= 0 || c.indexOf('anchor btc') >= 0 || c.indexOf('decentralized btc') >= 0) return 1.08;
    if (c === 'chain' || c.indexOf('rwa') >= 0 || c.indexOf('insurance') >= 0 || c.indexOf('payment') >= 0 || c.indexOf('index') >= 0) return 1.05;
    return 0.9;
  }

  function computeImpliedValue(row, cfg) {
    var rawGrowth = typeof row.change_7d === 'number' && isFinite(row.change_7d) ? row.change_7d : 0;
    var clamped = Math.min(cfg.growth_cap, Math.max(cfg.growth_floor, rawGrowth));
    var growthMult = round4(1 + (clamped / 100) * cfg.growth_weight);
    var effAge = Math.min(cfg.maturity_horizon_days, Math.max(0, row.age_days === null || row.age_days === undefined ? cfg.default_age_days : row.age_days));
    var matMult = round4(cfg.maturity_floor + (effAge / cfg.maturity_horizon_days) * cfg.maturity_span);
    var chainCount = Math.max(1, row.chains ? row.chains.length : 1);
    var chainMult = round4(1 + Math.min(cfg.chain_max_extra, chainCount - 1) * cfg.chain_step);
    var secMult = round4(sectorMultiplierFor(row.category));
    return Math.max(1, Math.round(row.tvl_usd * cfg.base_multiple * growthMult * matMult * chainMult * secMult));
  }

  // Exact browser mirror of lib/model.ts buildFarmSteps
  function gasProfileFor(chain) {
    var c = (chain || '').toLowerCase();
    if (c === 'ethereum' || c === 'bitcoin') {
      return { setupGas: '$6-$12 L1 gas', actionGas: '$8-$15 L1 gas', weeklyGas: '$4-$8/wk L1 gas' };
    }
    return { setupGas: '$0.15-$0.60 network gas', actionGas: '$0.25-$0.90 network gas', weeklyGas: '$0.20-$0.50/wk gas' };
  }

  function recommendedCapital(tvlUsd) {
    if (tvlUsd >= 1e9) return 500;
    if (tvlUsd >= 2.5e8) return 300;
    if (tvlUsd >= 5e7) return 200;
    if (tvlUsd >= 1.5e7) return 120;
    return 80;
  }

  function targetHoldDays(ageDays) {
    if (ageDays === null || ageDays === undefined) return 45;
    if (ageDays < 120) return 60;
    if (ageDays < 365) return 45;
    return 30;
  }

  function buildFarmSteps(p) {
    var primaryChain = p.chains && p.chains.length > 0 ? p.chains[0] : 'Ethereum';
    var secondaryChain = p.chains && p.chains.length > 1 ? p.chains[1] : null;
    var gas = gasProfileFor(primaryChain);
    var cap = recommendedCapital(p.tvl_usd);
    var hold = targetHoldDays(p.age_days);
    var cat = (p.category || 'DeFi').toLowerCase();
    var catLabel = p.category || 'DeFi';

    var deployAction = 'Supply $' + cap + ' of USDC or native collateral into ' + p.name + "'s core " + catLabel + ' contracts on ' + primaryChain + ' and retain the vault receipt tokens in the same wallet.';
    if (cat.indexOf('lend') >= 0 || cat.indexOf('cdp') >= 0) {
      deployAction = 'Deposit $' + cap + ' of USDC or blue-chip collateral into ' + p.name + "'s lending market on " + primaryChain + ', then borrow 30-40% against it to register both supply and borrow utilization.';
    } else if (cat.indexOf('dex') >= 0 || cat.indexOf('liquidity manager') >= 0 || cat === 'farm' || cat.indexOf('leveraged farm') >= 0) {
      deployAction = 'Provide $' + cap + ' of two-sided liquidity into ' + p.name + "'s deepest active pool on " + primaryChain + ', keeping the LP position within the active fee-earning range.';
    } else if (cat.indexOf('curator') >= 0 || cat.indexOf('allocator') >= 0 || cat.indexOf('yield') >= 0) {
      deployAction = 'Allocate $' + cap + ' into ' + p.name + "'s highest-TVL curated strategy vault on " + primaryChain + ' and hold the yield-bearing vault shares without transferring them out.';
    } else if (cat.indexOf('derivative') >= 0 || cat.indexOf('perpetual') >= 0 || cat.indexOf('basis') >= 0 || cat.indexOf('prediction') >= 0) {
      deployAction = 'Fund ' + p.name + "'s margin account on " + primaryChain + ' with $' + cap + ' USDC and execute at least two low-leverage ($' + (cap * 2) + ' notional) hedged positions to log maker/taker volume.';
    } else if (cat.indexOf('restak') >= 0 || cat.indexOf('staking') >= 0 || cat.indexOf('btc') >= 0) {
      deployAction = 'Stake $' + cap + ' of native collateral through ' + p.name + ' on ' + primaryChain + ' and hold the liquid restaked or staked receipt asset in your wallet to accrue epoch points.';
    } else if (cat.indexOf('bridge') >= 0) {
      var dest = secondaryChain || 'Arbitrum';
      deployAction = 'Bridge $' + cap + ' of USDC or ETH through ' + p.name + ' between ' + primaryChain + ' and ' + dest + ', plus supply a small liquidity buffer into ' + p.name + "'s bridge pool if open.";
    } else if (cat.indexOf('rwa') >= 0) {
      deployAction = 'Mint or acquire $' + cap + ' of ' + p.name + "'s tokenized yield instrument on " + primaryChain + ' and hold the asset across monthly yield distribution checkpoints.';
    }

    var cadenceAction = secondaryChain
      ? 'Execute one cross-chain interaction on ' + p.name + ' between ' + primaryChain + ' and ' + secondaryChain + ' every 7-10 days so your address qualifies on multi-chain usage tiers.'
      : 'Perform one recurring on-chain interaction on ' + p.name + ' (' + primaryChain + ') every 7 days—such as compounding yield, adjusting collateral, or rolling an epoch position.';

    var tenureNote = p.age_days !== null && p.age_days !== undefined ? p.age_days + ' days since ' + p.listed_at : 'unlisted start date';
    var trendNote = p.change_7d !== null && p.change_7d !== undefined ? (p.change_7d >= 0 ? '+' : '') + p.change_7d.toFixed(2) + '%' : 'unreported';

    return [
      {
        title: 'Dedicated Wallet & Gas Provisioning',
        action: 'Fund a dedicated non-custodial wallet on ' + primaryChain + ' with $' + cap + ' principal plus gas reserves specifically for farming ' + p.name + ' (' + catLabel + ').',
        cost: '$' + cap + ' principal + ' + gas.setupGas,
        time: '10 mins setup'
      },
      {
        title: 'Core Protocol Liquidity Deployment',
        action: deployAction,
        cost: '$' + cap + ' active deposit + ' + gas.actionGas,
        time: '15 mins execution'
      },
      {
        title: secondaryChain ? 'Multi-Chain Footprint Expansion' : 'Weekly Active Cadence',
        action: cadenceAction,
        cost: gas.weeklyGas,
        time: '10 mins / week'
      },
      {
        title: 'Time-Weighted Snapshot Retention',
        action: 'Maintain the $' + cap + ' position on ' + p.name + ' continuously for at least ' + hold + ' days (' + tenureNote + ') to clear time-weighted average balance (TWAB) anti-sybil filters.',
        cost: '$' + cap + ' opportunity lock ($0 extra fee)',
        time: hold + ' days hold'
      },
      {
        title: 'Epoch & Points Attestation Check',
        action: 'Verify accrued points, vault share snapshots, or governance badges on ' + p.name + "'s official " + primaryChain + ' interface once per bi-weekly epoch without revoking active approvals.',
        cost: '$0 read-only check',
        time: '5 mins / bi-weekly'
      },
      {
        title: 'Utilization Watch & Post-Snapshot Unwind',
        action: 'Monitor ' + p.name + "'s pool utilization and 7d TVL trend (" + trendNote + ') on ' + primaryChain + ', then unwind or rotate principal after the TGE snapshot cutoff.',
        cost: gas.actionGas,
        time: '10 mins unwind'
      }
    ];
  }

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on' && typeof attrs[k] === 'function') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined) continue;
      if (Array.isArray(child)) {
        child.forEach(function (c) {
          if (c !== null && c !== undefined) node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
        });
      } else if (typeof child === 'string') {
        node.appendChild(document.createTextNode(child));
      } else {
        node.appendChild(child);
      }
    }
    return node;
  }

  // Parse both query parameters (?slug=..., ?filter=...) and hash parameters (#slug=..., #filter=...)
  function parseUrlState() {
    var searchParams = new URLSearchParams(window.location.search || '');
    var hashParams = new URLSearchParams((window.location.hash || '').replace(/^#/, ''));
    var slug = searchParams.get('slug') || searchParams.get('p') || hashParams.get('slug') || hashParams.get('p');
    var filter = searchParams.get('filter') || searchParams.get('q') || hashParams.get('filter') || hashParams.get('q');
    var cat = searchParams.get('category') || hashParams.get('category');
    var tier = searchParams.get('tier') || hashParams.get('tier');
    if (slug) state.slug = slug.trim();
    if (filter) state.filter = filter.trim();
    if (cat) state.category = cat.trim();
    if (tier) state.tier = tier.trim();
  }

  function syncUrlHash() {
    var params = new URLSearchParams();
    if (state.slug) params.set('slug', state.slug);
    if (state.filter) params.set('filter', state.filter);
    if (state.category !== 'all') params.set('category', state.category);
    if (state.tier !== 'all') params.set('tier', state.tier);
    var next = params.toString();
    var base = window.location.pathname + window.location.search;
    window.history.replaceState(null, '', next ? base + '#' + next : base);
  }

  function filteredRows() {
    var q = state.filter.trim().toLowerCase();
    return DATA.rows.filter(function (r) {
      if (state.tier === 'watchlist' && r.tier !== 'watchlist') return false;
      if (state.tier === 'early' && r.tier !== 'early') return false;
      if (state.category !== 'all' && (r.category || 'Uncategorized') !== state.category) return false;
      if (state.chain !== 'all' && (!r.chains || r.chains.indexOf(state.chain) < 0)) return false;
      if (!q) return true;
      var hay = [r.name, r.slug, r.category || '', r.tier, (r.chains || []).join(' ')].join(' ').toLowerCase();
      return hay.indexOf(q) >= 0;
    });
  }

  function sortedRows(list) {
    var key = state.sort;
    var dir = state.dir;
    return list.slice().sort(function (a, b) {
      var av, bv;
      if (key === 'name') { av = a.name.toLowerCase(); bv = b.name.toLowerCase(); }
      else if (key === 'tvl') { av = a.tvl_usd; bv = b.tvl_usd; }
      else if (key === 'growth') { av = a.change_7d === null ? -9999 : a.change_7d; bv = b.change_7d === null ? -9999 : b.change_7d; }
      else if (key === 'age') { av = a.age_days === null ? -1 : a.age_days; bv = b.age_days === null ? -1 : b.age_days; }
      else if (key === 'chains') { av = (a.chains || []).length; bv = (b.chains || []).length; }
      else { av = a.implied_value_usd; bv = b.implied_value_usd; }
      if (av < bv) return -dir;
      if (av > bv) return dir;
      return a.rank - b.rank;
    });
  }

  function renderMasthead() {
    var c = DATA.counts;
    return h('header', { class: 'masthead' },
      h('div', { class: 'brand' },
        h('span', { class: 'radar-pulse', 'aria-hidden': 'true' }),
        h('span', { class: 'brand-title', text: 'Helios Token Radar' }),
        h('span', { class: 'brand-sub', text: 'Pre-Token Valuation & Farming Intelligence' })
      ),
      h('div', { class: 'masthead-meta' },
        h('span', { class: 'meta-pill' }, 'Snapshot ', h('b', { text: DATA.as_of })),
        h('span', { class: 'meta-pill' }, 'Model ', h('b', { text: DATA.model.version })),
        h('span', { class: 'meta-pill' }, 'Ranked ', h('b', { text: c.ranked_count + ' pre-token' })),
        h('span', { class: 'meta-pill' }, 'Excluded ', h('b', { text: c.live_token_excluded + ' live-token' }))
      )
    );
  }

  function renderHero() {
    var c = DATA.counts;
    var m = DATA.model;
    return h('section', { class: 'hero-grid' },
      h('div', { class: 'card' },
        h('h1', { class: 'hero-title', text: c.ranked_count + ' Pre-Token Protocols Ranked by Implied Launch Valuation' }),
        h('p', {
          class: 'hero-desc',
          text: 'Covers all ' + c.watchlist_count + ' DefiLlama watchlist protocols ($' + Math.round(DATA.floor_usd / 1e6) + 'M+ TVL floor) plus the ' + c.early_count + ' strongest early-stage pre-token protocols below the floor. Protocols whose token already trades (' + c.live_token_excluded + ' in snapshot) and CEX/wrapped pools (' + c.filtered_pre_token_excluded + ') are strictly excluded from the ranking.'
        }),
        h('div', { class: 'formula-strip' },
          h('span', { class: 'tag', text: 'MODEL FORMULA' }),
          h('span', {
            text: 'Implied = round( TVL × ' + m.base_multiple + ' × GrowthMult[7d] × MaturityMult[age] × ChainMult[chains] × SectorMult[category] )'
          })
        )
      ),
      h('div', { class: 'card partition-box' },
        h('div', { class: 'partition-head' },
          h('span', { text: 'Sealed Snapshot Protocol Partition (' + c.total_protocols + ' total >= $5M TVL)' }),
          h('span', { class: 'num', text: c.pre_token_total + ' no-token / ' + c.live_token_excluded + ' live-token' })
        ),
        h('div', { class: 'partition-bar', 'aria-hidden': 'true' },
          h('div', { class: 'seg-wl', style: 'width:' + ((c.watchlist_count / c.total_protocols) * 100).toFixed(1) + '%' }),
          h('div', { class: 'seg-early', style: 'width:' + ((c.early_count / c.total_protocols) * 100).toFixed(1) + '%' }),
          h('div', { class: 'seg-filt', style: 'width:' + ((c.filtered_pre_token_excluded / c.total_protocols) * 100).toFixed(1) + '%' }),
          h('div', { class: 'seg-live', style: 'width:' + ((c.live_token_excluded / c.total_protocols) * 100).toFixed(1) + '%' })
        ),
        h('div', { class: 'stat-grid' },
          h('div', { class: 'stat-cell hl-wl' },
            h('span', { class: 'num', text: c.watchlist_count + ' / ' + c.watchlist_count }),
            h('span', { class: 'lbl', text: 'Watchlist Floor (>=$50M)' })
          ),
          h('div', { class: 'stat-cell hl-early' },
            h('span', { class: 'num', text: String(c.early_count) }),
            h('span', { class: 'lbl', text: 'Early Radar (<$50M)' })
          ),
          h('div', { class: 'stat-cell hl-live' },
            h('span', { class: 'num', text: String(c.live_token_excluded) }),
            h('span', { class: 'lbl', text: 'Live Tokens Excluded' })
          ),
          h('div', { class: 'stat-cell' },
            h('span', { class: 'num', text: String(c.filtered_pre_token_excluded) }),
            h('span', { class: 'lbl', text: 'CEX / Wrappers Set Aside' })
          )
        )
      )
    );
  }

  function renderToolbar(matchedCount) {
    var categories = Array.from(new Set(DATA.rows.map(function (r) { return r.category || 'Uncategorized'; }))).sort();
    var chainCounts = {};
    DATA.rows.forEach(function (r) {
      (r.chains || []).forEach(function (ch) { chainCounts[ch] = (chainCounts[ch] || 0) + 1; });
    });
    var topChains = Object.keys(chainCounts).sort(function (a, b) { return chainCounts[b] - chainCounts[a]; }).slice(0, 20);

    var searchInput = h('input', {
      type: 'search',
      class: 'search-input',
      id: 'filter-input',
      placeholder: 'Filter name, category, chain...',
      value: state.filter,
      'aria-label': 'Filter protocols'
    });
    searchInput.addEventListener('input', function () {
      state.filter = searchInput.value;
      syncUrlHash();
      renderBoardArea();
    });

    var catSelect = h('select', { class: 'select-ctrl', id: 'cat-select', 'aria-label': 'Category filter' },
      h('option', { value: 'all', text: 'All Categories (' + categories.length + ')' }),
      categories.map(function (cat) {
        return h('option', { value: cat, text: cat, selected: state.category === cat ? 'selected' : null });
      })
    );
    catSelect.addEventListener('change', function () {
      state.category = catSelect.value;
      syncUrlHash();
      render();
    });

    var chainSelect = h('select', { class: 'select-ctrl', id: 'chain-select', 'aria-label': 'Chain filter' },
      h('option', { value: 'all', text: 'All Chains' }),
      topChains.map(function (ch) {
        return h('option', { value: ch, text: ch + ' (' + chainCounts[ch] + ')', selected: state.chain === ch ? 'selected' : null });
      })
    );
    chainSelect.addEventListener('change', function () {
      state.chain = chainSelect.value;
      syncUrlHash();
      render();
    });

    function tierBtn(id, label) {
      return h('button', {
        type: 'button',
        'aria-pressed': state.tier === id ? 'true' : 'false',
        text: label,
        onclick: function () {
          state.tier = id;
          syncUrlHash();
          render();
        }
      });
    }

    var hasActiveFilter = state.filter !== '' || state.category !== 'all' || state.chain !== 'all' || (state.tier !== 'all' && state.tier !== 'live');
    var matchedRows = filteredRows();
    var sumTvl = matchedRows.reduce(function (acc, r) { return acc + r.tvl_usd; }, 0);
    var sumImplied = matchedRows.reduce(function (acc, r) { return acc + r.implied_value_usd; }, 0);

    return h('div', { class: 'toolbar' },
      h('div', { class: 'ctrl-group' },
        h('label', { class: 'ctrl-label', for: 'filter-input', text: 'Filter' }),
        searchInput
      ),
      h('div', { class: 'ctrl-group' },
        h('label', { class: 'ctrl-label', for: 'cat-select', text: 'Sector' }),
        catSelect
      ),
      h('div', { class: 'ctrl-group' },
        h('label', { class: 'ctrl-label', for: 'chain-select', text: 'Chain' }),
        chainSelect
      ),
      h('div', { class: 'ctrl-group' },
        h('span', { class: 'ctrl-label', text: 'Cohort' }),
        h('div', { class: 'segmented' },
          tierBtn('all', 'All Pre-Token (200)'),
          tierBtn('watchlist', 'Watchlist (40)'),
          tierBtn('early', 'Early (<$50M, 160)'),
          tierBtn('live', 'Excluded Live (' + DATA.counts.live_token_excluded + ')')
        )
      ),
      hasActiveFilter ? h('div', { class: 'active-filter-banner' },
        h('span', { text: 'Active Filter: ' + [state.filter, state.category !== 'all' ? state.category : '', state.chain !== 'all' ? state.chain : '', state.tier !== 'all' ? state.tier : ''].filter(Boolean).join(' · ') }),
        h('button', {
          type: 'button',
          text: 'Reset',
          onclick: function () {
            state.filter = '';
            state.category = 'all';
            state.chain = 'all';
            state.tier = 'all';
            syncUrlHash();
            render();
          }
        })
      ) : null,
      h('div', {
        class: 'toolbar-summary',
        id: 'toolbar-count',
        text: state.tier === 'live'
          ? 'Showing top ' + DATA.live.length + ' of ' + DATA.counts.live_token_excluded + ' excluded live-token protocols'
          : matchedCount + ' / ' + DATA.counts.ranked_count + ' rows · TVL ' + fmtUsd(sumTvl) + ' · Implied ' + fmtUsd(sumImplied)
      })
    );
  }

  function sortColHeader(key, label) {
    var active = state.sort === key;
    var arrow = active ? (state.dir < 0 ? ' ↓' : ' ↑') : '';
    return h('th', { scope: 'col' },
      h('button', {
        type: 'button',
        text: label + arrow,
        onclick: function () {
          if (state.sort === key) state.dir = -state.dir;
          else { state.sort = key; state.dir = key === 'name' ? 1 : -1; }
          renderBoardArea();
        }
      })
    );
  }

  function renderPreTokenTable() {
    var list = sortedRows(filteredRows());
    if (list.length === 0) {
      return h('div', { class: 'board-panel empty-state' },
        h('h2', { text: 'No pre-token protocols match your current filter' }),
        h('p', { style: 'margin:8px 0 14px;color:var(--ink-secondary)', text: 'Try clearing the search query or switching sector/cohort filters.' }),
        h('button', {
          type: 'button',
          class: 'close-btn',
          text: 'Reset all filters',
          onclick: function () {
            state.filter = '';
            state.category = 'all';
            state.chain = 'all';
            state.tier = 'all';
            syncUrlHash();
            render();
          }
        })
      );
    }

    var maxImplied = DATA.rows[0] ? DATA.rows[0].implied_value_usd : 1;
    var tbody = h('tbody');

    list.forEach(function (r) {
      var gText = fmtPct(r.change_7d);
      var gClass = r.change_7d === null ? '' : r.change_7d >= 0 ? 'pos' : 'neg';
      var cap = recommendedCapital(r.tvl_usd);
      var hold = targetHoldDays(r.age_days);
      var primaryChain = r.chains && r.chains.length ? r.chains[0] : 'Ethereum';
      var barPct = Math.max(4, Math.min(100, Math.round((Math.pow(r.implied_value_usd / maxImplied, 0.45)) * 100)));

      var tr = h('tr', {
        'data-selected': state.slug === r.slug ? 'true' : 'false',
        tabindex: '0',
        onclick: function () { openProtocolDetail(r.slug); },
        onkeydown: function (e) {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openProtocolDetail(r.slug);
          }
        }
      },
        h('td', { class: 'num' }, h('span', { class: 'rank-badge', 'data-top': r.rank <= 3 ? 'true' : 'false', text: '#' + r.rank })),
        h('td', null,
          h('div', { class: 'proto-cell' },
            h('span', { class: 'proto-name', text: r.name }),
            h('span', {
              class: 'tier-pill ' + (r.tier === 'watchlist' ? 'tier-wl' : 'tier-early'),
              text: r.tier === 'watchlist' ? 'Watchlist' : 'Early <$50M'
            })
          ),
          h('span', {
            class: 'chain-sub',
            text: (r.chains && r.chains.length ? r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') : 'Mainnet')
          })
        ),
        h('td', null, h('span', { class: 'cat-tag', text: r.category || 'Uncategorized' })),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + gClass, text: gText }),
        h('td', { class: 'num', text: r.age_days !== null ? r.age_days + 'd' : 'unlisted' }),
        h('td', {
          class: 'mult-Readout',
          text: r.growth_multiplier.toFixed(2) + '× · ' + r.maturity_multiplier.toFixed(2) + '× · ' + r.sector_multiplier.toFixed(2) + '×'
        }),
        h('td', null,
          h('div', { class: 'implied-cell' },
            h('div', { class: 'val-bar', 'aria-hidden': 'true' }, h('i', { style: 'width:' + barPct + '%' })),
            h('span', { class: 'implied-val', text: fmtUsd(r.implied_value_usd) })
          )
        ),
        h('td', { class: 'farm-preview' },
          h('b', { text: '$' + cap + ' · ' + hold + 'd' }),
          ' · ' + primaryChain + ' (6 steps)'
        )
      );
      tbody.appendChild(tr);
    });

    return h('div', { class: 'board-panel' },
      h('div', { class: 'table-scroll' },
        h('table', null,
          h('thead', null,
            h('tr', null,
              sortColHeader('implied', 'Rank'),
              sortColHeader('name', 'Protocol & Chains'),
              h('th', { scope: 'col', text: 'Category' }),
              sortColHeader('tvl', 'TVL'),
              sortColHeader('growth', '7d'),
              sortColHeader('age', 'Tenure'),
              sortColHeader('chains', 'Factors (G·M·S)'),
              sortColHeader('implied', 'Implied Value'),
              h('th', { scope: 'col', text: 'Farm Playbook' })
            )
          ),
          tbody
        )
      )
    );
  }

  function renderLiveTokenTable() {
    var tbody = h('tbody');
    DATA.live.forEach(function (r) {
      var ratio = r.mcap_usd && r.tvl_usd > 0 ? (r.mcap_usd / r.tvl_usd).toFixed(2) + '×' : '—';
      tbody.appendChild(h('tr', null,
        h('td', null, h('span', { class: 'tier-pill tier-live', text: 'LIVE (' + (r.symbol || 'TOKEN') + ')' })),
        h('td', null,
          h('span', { class: 'proto-name', text: r.name }),
          h('span', { class: 'chain-sub', text: (r.chains || []).slice(0, 3).join(', ') })
        ),
        h('td', null, h('span', { class: 'cat-tag', text: r.category || 'DeFi' })),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num ' + (r.change_7d !== null && r.change_7d >= 0 ? 'pos' : 'neg'), text: fmtPct(r.change_7d) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', { class: 'num', text: ratio }),
        h('td', { class: 'farm-preview', text: 'Excluded from pre-token board: token already trades on open market.' })
      ));
    });

    return h('div', { class: 'board-panel' },
      h('div', { class: 'table-scroll' },
        h('table', null,
          h('thead', null,
            h('tr', null,
              h('th', { scope: 'col', text: 'Token Status' }),
              h('th', { scope: 'col', text: 'Protocol' }),
              h('th', { scope: 'col', text: 'Category' }),
              h('th', { scope: 'col', text: 'TVL' }),
              h('th', { scope: 'col', text: '7d Change' }),
              h('th', { scope: 'col', text: 'Live Market Cap' }),
              h('th', { scope: 'col', text: 'MCap / TVL' }),
              h('th', { scope: 'col', text: 'Exclusion Rule' })
            )
          ),
          tbody
        )
      )
    );
  }

  function renderMethodology() {
    var m = DATA.model;
    return h('section', { class: 'methodology-grid' },
      h('div', { class: 'card' },
        h('h2', { style: 'font-size:15px;font-weight:700', text: 'Five-Factor Implied Valuation Model (' + m.version + ')' }),
        h('ul', { class: 'method-list' },
          h('li', null, h('b', { text: 'Base TVL Anchor (' + m.base_multiple + '×): ' }), 'Baseline implied valuation starts at 32% of verified DefiLlama TVL.'),
          h('li', null, h('b', { text: '7d Momentum Multiplier: ' }), '1 + (clamp(change_7d, -50%, +150%) / 100) × 0.45 — rewards expanding capital inflows.'),
          h('li', null, h('b', { text: 'Tokenless Tenure Multiplier: ' }), '0.65 + (min(age_days, 900) / 900) × 0.55 — protocols operating longer without a token command higher sticky-liquidity premiums (unlisted age uses 270d).'),
          h('li', null, h('b', { text: 'Multi-Chain & Sector Multipliers: ' }), '+3.5% per additional chain (up to 9 chains, 1.28×) and category fee-capture weight (1.25× DEX/Perps/Prediction, 1.15× Lending/CDP/Yield, 1.08× Curators/Restaking, 1.05× RWA/Chains, 0.90× Bridges/Wrappers).')
        )
      ),
      h('div', { class: 'card' },
        h('h2', { style: 'font-size:15px;font-weight:700', text: 'Cohort Selection & Farming Playbook Methodology' }),
        h('ul', { class: 'method-list' },
          h('li', null, h('b', { text: 'Strict Pre-Token Separation: ' }), 'All ' + DATA.counts.live_token_excluded + ' protocols with a live token (gecko_id, symbol, or mcap_usd) and ' + DATA.counts.filtered_pre_token_excluded + ' CEX/wrapped pools are excluded from ranking.'),
          h('li', null, h('b', { text: 'Watchlist Floor + Early Discovery: ' }), 'Ranks all 40 watchlist protocols (>=$50M TVL) plus the 160 strongest pre-token protocols below $50M.'),
          h('li', null, h('b', { text: 'Actionable 6-Step Farm Plans: ' }), 'Every protocol gets a custom 6-step execution plan calibrated to its TVL tier ($80–$500 capital), L1 vs L2 gas profile, category mechanics, cross-chain footprint, and TWAB hold duration.')
        )
      )
    );
  }

  var boardMount = h('div', { id: 'board-mount' });
  var backdrop = h('div', {
    class: 'detail-backdrop',
    id: 'detail-backdrop',
    hidden: 'hidden',
    onclick: function (e) {
      if (e.target === backdrop) closeProtocolDetail();
    }
  });

  function renderBoardArea() {
    var matched = filteredRows();
    var sumTvl = matched.reduce(function (acc, r) { return acc + r.tvl_usd; }, 0);
    var sumImplied = matched.reduce(function (acc, r) { return acc + r.implied_value_usd; }, 0);
    var countNode = document.getElementById('toolbar-count');
    if (countNode) {
      countNode.textContent = state.tier === 'live'
        ? 'Showing top ' + DATA.live.length + ' of ' + DATA.counts.live_token_excluded + ' excluded live-token protocols'
        : matched.length + ' / ' + DATA.counts.ranked_count + ' rows · TVL ' + fmtUsd(sumTvl) + ' · Implied ' + fmtUsd(sumImplied);
    }
    boardMount.textContent = '';
    boardMount.appendChild(state.tier === 'live' ? renderLiveTokenTable() : renderPreTokenTable());
  }

  function openProtocolDetail(slug) {
    var row = null;
    for (var i = 0; i < DATA.rows.length; i++) {
      if (DATA.rows[i].slug === slug) { row = DATA.rows[i]; break; }
    }
    if (!row) return;
    state.slug = slug;
    syncUrlHash();
    renderBoardArea();

    var recomputed = computeImpliedValue(row, DATA.model);
    var steps = buildFarmSteps(row);

    backdrop.textContent = '';
    backdrop.removeAttribute('hidden');

    var drawer = h('aside', { class: 'detail-drawer', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'drawer-proto-title' },
      h('div', { class: 'drawer-top' },
        h('div', null,
          h('div', { class: 'drawer-meta' },
            h('span', { class: 'rank-badge', text: 'Rank #' + row.rank + ' of ' + DATA.counts.ranked_count }),
            h('span', {
              class: 'tier-pill ' + (row.tier === 'watchlist' ? 'tier-wl' : 'tier-early'),
              text: row.tier === 'watchlist' ? 'Watchlist Floor (>=$50M)' : 'Early Discovery (<$50M)'
            }),
            h('span', { class: 'cat-tag', text: row.category || 'Uncategorized' }),
            h('span', { class: 'cat-tag', text: 'Pre-Token (No gecko_id / symbol)' })
          ),
          h('h2', { class: 'drawer-title', id: 'drawer-proto-title', text: row.name + ' (' + row.slug + ')' }),
          h('p', {
            class: 'chain-sub',
            text: 'Active Chains (' + (row.chains ? row.chains.length : 1) + '): ' + (row.chains && row.chains.length ? row.chains.join(', ') : 'Mainnet') + ' · Listed: ' + fmtAge(row.age_days, row.listed_at)
          })
        ),
        h('button', {
          type: 'button',
          class: 'close-btn',
          text: 'Close [Esc]',
          onclick: function () { closeProtocolDetail(); }
        })
      ),
      h('section', { class: 'eq-box' },
        h('div', { class: 'eq-header' },
          h('h3', { text: 'Implied Launch Valuation Breakdown' }),
          h('span', {
            class: 'verify-ok',
            text: recomputed === row.implied_value_usd
              ? '✓ Verified: computeImpliedValue() == ' + fmtExactUsd(row.implied_value_usd)
              : 'Recomputed: ' + fmtExactUsd(recomputed)
          })
        ),
        h('div', { class: 'eq-factors' },
          h('div', { class: 'eq-factor' },
            h('span', { class: 'f-lbl', text: '1. Base TVL (0.32×)' }),
            h('span', { class: 'f-val', text: fmtUsd(row.tvl_usd * DATA.model.base_multiple) }),
            h('span', { class: 'f-sub', text: 'TVL ' + fmtUsd(row.tvl_usd) })
          ),
          h('div', { class: 'eq-factor' },
            h('span', { class: 'f-lbl', text: '2. 7d Momentum' }),
            h('span', { class: 'f-val', text: row.growth_multiplier.toFixed(4) + '×' }),
            h('span', { class: 'f-sub', text: '7d: ' + fmtPct(row.change_7d) })
          ),
          h('div', { class: 'eq-factor' },
            h('span', { class: 'f-lbl', text: '3. Tenure Mult' }),
            h('span', { class: 'f-val', text: row.maturity_multiplier.toFixed(4) + '×' }),
            h('span', { class: 'f-sub', text: row.age_days !== null ? row.age_days + 'd tokenless' : '270d default' })
          ),
          h('div', { class: 'eq-factor' },
            h('span', { class: 'f-lbl', text: '4. Chain Mult' }),
            h('span', { class: 'f-val', text: row.chain_multiplier.toFixed(4) + '×' }),
            h('span', { class: 'f-sub', text: (row.chains ? row.chains.length : 1) + ' chain(s)' })
          ),
          h('div', { class: 'eq-factor' },
            h('span', { class: 'f-lbl', text: '5. Sector Mult' }),
            h('span', { class: 'f-val', text: row.sector_multiplier.toFixed(2) + '×' }),
            h('span', { class: 'f-sub', text: row.category || 'Other' })
          ),
          h('div', { class: 'eq-factor eq-total' },
            h('span', { class: 'f-lbl', text: 'Implied Value' }),
            h('span', { class: 'f-val', text: fmtUsd(row.implied_value_usd) }),
            h('span', { class: 'f-sub', text: fmtExactUsd(row.implied_value_usd) })
          )
        )
      ),
      h('section', { class: 'steps-section' },
        h('h3', { text: 'Concrete 6-Step Farming Playbook — Cost & Time Estimates' }),
        h('ol', { class: 'steps-list' },
          steps.map(function (st, idx) {
            return h('li', { class: 'step-card' },
              h('span', { class: 'step-num', text: String(idx + 1) }),
              h('div', { class: 'step-body' },
                h('div', { class: 'step-head' },
                  h('span', { class: 'step-title', text: st.title }),
                  h('div', { class: 'step-pills' },
                    h('span', { class: 'pill-cost', text: 'Cost: ' + st.cost }),
                    h('span', { class: 'pill-time', text: 'Time: ' + st.time })
                  )
                ),
                h('p', { class: 'step-desc', text: st.action })
              )
            );
          })
        )
      )
    );

    backdrop.appendChild(drawer);
  }

  function closeProtocolDetail() {
    state.slug = null;
    backdrop.setAttribute('hidden', 'hidden');
    backdrop.textContent = '';
    syncUrlHash();
    renderBoardArea();
  }

  function render() {
    var matched = filteredRows();
    root.textContent = '';
    var shell = h('div', { class: 'shell' },
      renderMasthead(),
      renderHero(),
      renderToolbar(matched.length),
      boardMount,
      renderMethodology()
    );
    root.appendChild(shell);
    root.appendChild(backdrop);
    renderBoardArea();
    root.setAttribute('aria-busy', 'false');
    if (state.slug) openProtocolDetail(state.slug);
  }

  parseUrlState();
  render();

  window.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && state.slug) closeProtocolDetail();
  });
})();
