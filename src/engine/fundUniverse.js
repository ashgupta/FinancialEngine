/**
 * Default 401(k) Fund Menu.
 *
 * Generic catalog of fund categories that appear in most large-employer 401(k)
 * plans. Asset classes match the `id`s defined in engine/portfolio.js so we can
 * align with the existing risk-tolerance → allocation model.
 *
 * Expense ratios are typical-low-cost-index-fund estimates. User should override
 * with their plan's actual fund tickers + fees for accurate planning.
 */

// Dell Technologies 401(k) plan menu (Fidelity NetBenefits)
// Source: Dell Inc. Form 5500 filing + NetBenefits portal data as of 2026.
export const DELL_K401_FUNDS = [
  // Equity — US
  { id: 'dell_sp500',      ticker: 'OZY9',  name: 'State Street S&P 500 Index NL Ser A',  assetClass: 'us_equity',   expenseRatio: 0.0010, currentBalance: 346000 },
  { id: 'dell_sm_mid',     ticker: 'OJ95',  name: 'State Street Russell Small/Mid Cap Index', assetClass: 'us_equity', expenseRatio: 0.0010 },
  // Equity — International
  { id: 'dell_intl',       ticker: 'OZO9',  name: 'State Street Global All Cap Equity ex-US Index', assetClass: 'intl_equity', expenseRatio: 0.0010, currentBalance: 86000 },
  { id: 'dell_em',         ticker: 'EM',    name: 'Emerging Markets Equity Fund',        assetClass: 'intl_equity', expenseRatio: 0.0060, currentBalance: 59000 },
  // Real estate
  { id: 'dell_re',         ticker: 'RE',    name: 'JPMorgan Diversified Commercial Real Estate Fund', assetClass: 'real_estate', expenseRatio: 0.0060, currentBalance: 83000 },
  // Bonds
  { id: 'dell_bond_idx',   ticker: 'OO9V',  name: 'State Street U.S. Bond Index NL Cl A', assetClass: 'us_bonds',    expenseRatio: 0.0010 },
  { id: 'dell_core_plus',  ticker: 'OJ6B',  name: 'Prudential Core Plus Bond Fund Cl 5',  assetClass: 'us_bonds',    expenseRatio: 0.0040 },
  { id: 'dell_jh_bond',    ticker: 'JH',    name: 'John Hancock Core Plus Fixed Income Trust', assetClass: 'us_bonds', expenseRatio: 0.0040 },
  // Cash / Stable value
  { id: 'dell_stable',     ticker: 'W',     name: 'BlackRock Short-Term Investment Fund W', assetClass: 'cash',       expenseRatio: 0.0015 },
  // Target-date PMP funds (Pre-Mixed Portfolios by Mercer)
  { id: 'dell_pmp_2015',   ticker: 'PMP15', name: 'Dell PMP 2015 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2020',   ticker: 'PMP20', name: 'Dell PMP 2020 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2025',   ticker: 'PMP25', name: 'Dell PMP 2025 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2030',   ticker: 'PMP30', name: 'Dell PMP 2030 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2035',   ticker: 'PMP35', name: 'Dell PMP 2035 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2040',   ticker: 'PMP40', name: 'Dell PMP 2040 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2045',   ticker: 'PMP45', name: 'Dell PMP 2045 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2050',   ticker: 'PMP50', name: 'Dell PMP 2050 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2055',   ticker: 'PMP55', name: 'Dell PMP 2055 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
  { id: 'dell_pmp_2060',   ticker: 'PMP60', name: 'Dell PMP 2060 Fund',                   assetClass: 'cash',        expenseRatio: 0.0050 },
];

export const DELL_ETF_PROXY_MAP = {
  dell_sp500:     'SPY',
  dell_sm_mid:    'IJR',
  dell_intl:      'VEA',
  dell_em:        'VWO',
  dell_re:        'VNQ',
  dell_bond_idx:  'AGG',
  dell_core_plus: 'BND',
  dell_jh_bond:   'BND',
  dell_stable:    'BIL',
};

export const DEFAULT_K401_FUNDS = [
  // Equity — US
  { id: 'sp500_idx',     ticker: 'VFIAX', name: 'Vanguard 500 Index (S&P 500)',         assetClass: 'us_equity',   expenseRatio: 0.0004 },
  { id: 'total_us_idx',  ticker: 'VTSAX', name: 'Vanguard Total Stock Market Index',     assetClass: 'us_equity',   expenseRatio: 0.0004 },
  { id: 'us_smallcap',   ticker: 'VSMAX', name: 'Vanguard Small-Cap Index',              assetClass: 'us_equity',   expenseRatio: 0.0005 },
  // Equity — International
  { id: 'intl_idx',      ticker: 'VTIAX', name: 'Vanguard Total International Stock',    assetClass: 'intl_equity', expenseRatio: 0.0011 },
  { id: 'em_idx',        ticker: 'VEMAX', name: 'Vanguard Emerging Markets Index',       assetClass: 'intl_equity', expenseRatio: 0.0014 },
  // Bonds
  { id: 'total_bond',    ticker: 'VBTLX', name: 'Vanguard Total Bond Market Index',      assetClass: 'us_bonds',    expenseRatio: 0.0005 },
  { id: 'intl_bond',     ticker: 'VTABX', name: 'Vanguard Total International Bond',     assetClass: 'intl_bonds',  expenseRatio: 0.0011 },
  { id: 'tips_fund',     ticker: 'VAIPX', name: 'Vanguard Inflation-Protected Securities', assetClass: 'tips',     expenseRatio: 0.0010 },
  // Real assets
  { id: 'reit_idx',      ticker: 'VGSLX', name: 'Vanguard Real Estate Index',            assetClass: 'real_estate', expenseRatio: 0.0013 },
  // Stable value / cash
  { id: 'stable_value',  ticker: 'STABLE',name: 'Stable Value Fund (generic)',            assetClass: 'cash',        expenseRatio: 0.0030 },
  { id: 'money_market',  ticker: 'VMFXX', name: 'Vanguard Federal Money Market',          assetClass: 'cash',        expenseRatio: 0.0011 },
];

export const ASSET_CLASS_LABELS = {
  us_equity:    'US Equities',
  intl_equity:  'International Equities',
  us_bonds:     'US Bonds',
  intl_bonds:   'International Bonds',
  tips:         'TIPS',
  real_estate:  'REITs',
  commodities:  'Commodities',
  cash:         'Cash / Stable Value',
};

export const ASSET_CLASS_OPTIONS = Object.entries(ASSET_CLASS_LABELS).map(([id, label]) => ({ id, label }));
