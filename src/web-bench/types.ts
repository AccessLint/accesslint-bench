/** Per-site raw result — one line of JSONL output */
export interface SiteResult {
  origin: string;
  rank: number;
  status: "ok" | "error";
  error?: string;
  axeTimeMs: number;
  alTimeMs: number;
  axeViolationCount: number;
  alViolationCount: number;
  /** WCAG criteria found by axe-core, e.g. ["1.1.1", "4.1.2"] */
  axeWcagCriteria: string[];
  /** WCAG criteria found by @accesslint/core */
  alWcagCriteria: string[];
  criteriaDetail: CriterionPageResult[];
  timestamp: string;
}

/** Per-criterion detail for a single page */
export interface CriterionPageResult {
  criterion: string;
  axeFound: boolean;
  alFound: boolean;
  axeRuleIds: string[];
  alRuleIds: string[];
}

/** What page.evaluate returns from the browser context */
export interface BrowserAuditResult {
  axeTimeMs: number;
  alTimeMs: number;
  axeViolations: { id: string; tags: string[]; nodeCount: number; impact: string | null }[];
  alViolations: { ruleId: string; count: number; impact: string }[];
  alRuleWcagMap: Record<string, string[]>;
}

/** Aggregate concordance for a single WCAG criterion across all sites */
export interface CriterionConcordance {
  criterion: string;
  bothFound: number;
  axeOnly: number;
  alOnly: number;
  neitherFound: number;
  agreement: number;
  cohenKappa: number;
}

export interface BenchOptions {
  sampleSize: number;
  concurrency: number;
  timeout: number;
  outputFile: string;
  seed?: number;
}
