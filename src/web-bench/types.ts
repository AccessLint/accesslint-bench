/** Per-site raw result — one line of JSONL output */
export interface SiteResult {
  origin: string;
  rank: number;
  status: "ok" | "error";
  error?: string;
  domElementCount: number;
  axeTimeMs: number;
  alTimeMs: number;
  ibmTimeMs: number;
  axeStatus: "ok" | "error";
  alStatus: "ok" | "error";
  ibmStatus: "ok" | "error";
  axeError: string | null;
  alError: string | null;
  ibmError: string | null;
  axeViolationCount: number;
  alViolationCount: number;
  ibmViolationCount: number;
  /** WCAG criteria found by axe-core, e.g. ["1.1.1", "4.1.2"] */
  axeWcagCriteria: string[];
  /** WCAG criteria found by @accesslint/core */
  alWcagCriteria: string[];
  /** WCAG criteria found by IBM Equal Access */
  ibmWcagCriteria: string[];
  criteriaDetail: CriterionPageResult[];
  timestamp: string;
}

/** Per-criterion detail for a single page */
export interface CriterionPageResult {
  criterion: string;
  axeFound: boolean;
  alFound: boolean;
  ibmFound: boolean;
  axeRuleIds: string[];
  alRuleIds: string[];
  ibmRuleIds: string[];
  axeNodeCount: number;
  alNodeCount: number;
  ibmNodeCount: number;
}

/** What page.evaluate returns from the browser context */
export interface BrowserAuditResult {
  domElementCount: number;
  axeTimeMs: number;
  alTimeMs: number;
  ibmTimeMs: number;
  axeStatus: "ok" | "error";
  alStatus: "ok" | "error";
  ibmStatus: "ok" | "error";
  axeError: string | null;
  alError: string | null;
  ibmError: string | null;
  axeViolations: { id: string; tags: string[]; nodeCount: number; impact: string | null }[];
  alViolations: { ruleId: string; count: number; impact: string }[];
  ibmViolations: { ruleId: string; count: number }[];
  alRuleWcagMap: Record<string, string[]>;
  ibmRuleWcagMap: Record<string, string[]>;
}

/** Aggregate concordance for a single WCAG criterion across all sites */
export interface CriterionConcordance {
  criterion: string;
  allThree: number;
  twoOfThree: number;
  oneOnly: number;
  noneFound: number;
  axeAlKappa: number;
  axeIbmKappa: number;
  alIbmKappa: number;
}

export interface BenchOptions {
  sampleSize: number;
  concurrency: number;
  timeout: number;
  outputFile: string;
  seed?: number;
  shardIndex?: number;
  shardTotal?: number;
}
