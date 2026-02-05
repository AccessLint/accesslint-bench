import { resolve } from "node:path";
import type { BrowserContext } from "playwright";
import type { BrowserAuditResult, SiteResult, CriterionPageResult } from "./types.js";
import { extractAxeWcagCriteria } from "./wcag-mapping.js";

const AXE_PATH = resolve("node_modules/axe-core/axe.min.js");
const AL_PATH = resolve("node_modules/@accesslint/core/dist/index.iife.js");

/**
 * Browser-side audit code injected via page.evaluate (as a string to
 * avoid tsx __name transforms — same pattern as browser-bench.ts).
 */
const AUDIT_CODE = `(async () => {
  var alRuleWcagMap = {};
  if (window.AccessLintCore && window.AccessLintCore.getActiveRules) {
    var rules = window.AccessLintCore.getActiveRules();
    for (var i = 0; i < rules.length; i++) {
      alRuleWcagMap[rules[i].id] = rules[i].wcag || [];
    }
  }

  var axeTimeMs = 0;
  var axeViolations = [];
  try {
    var axeStart = performance.now();
    var axeResults = await window.axe.run(document, { resultTypes: ["violations"] });
    axeTimeMs = performance.now() - axeStart;
    axeViolations = axeResults.violations.map(function(v) {
      return { id: v.id, tags: v.tags, nodeCount: v.nodes.length, impact: v.impact };
    });
  } catch (e) {
    axeTimeMs = -1;
  }

  var alTimeMs = 0;
  var alViolations = [];
  try {
    var alStart = performance.now();
    var alResults = window.AccessLintCore.runAudit(document);
    alTimeMs = performance.now() - alStart;
    var alViolMap = {};
    for (var j = 0; j < alResults.violations.length; j++) {
      var viol = alResults.violations[j];
      if (!alViolMap[viol.ruleId]) {
        alViolMap[viol.ruleId] = { ruleId: viol.ruleId, count: 0, impact: viol.impact };
      }
      alViolMap[viol.ruleId].count++;
    }
    alViolations = Object.values(alViolMap);
  } catch (e) {
    alTimeMs = -1;
  }

  return {
    axeTimeMs: axeTimeMs,
    alTimeMs: alTimeMs,
    axeViolations: axeViolations,
    alViolations: alViolations,
    alRuleWcagMap: alRuleWcagMap
  };
})()`;

/** Map raw browser results to WCAG criteria and build per-criterion detail. */
function buildCriteriaDetail(
  raw: BrowserAuditResult,
): { axeWcag: string[]; alWcag: string[]; detail: CriterionPageResult[] } {
  const axeWcagSet = new Set<string>();
  const axeCriteriaToRules = new Map<string, string[]>();
  for (const v of raw.axeViolations) {
    for (const c of extractAxeWcagCriteria(v.tags)) {
      axeWcagSet.add(c);
      const existing = axeCriteriaToRules.get(c) ?? [];
      existing.push(v.id);
      axeCriteriaToRules.set(c, existing);
    }
  }

  const alWcagSet = new Set<string>();
  const alCriteriaToRules = new Map<string, string[]>();
  for (const v of raw.alViolations) {
    const criteria = raw.alRuleWcagMap[v.ruleId] ?? [];
    for (const c of criteria) {
      alWcagSet.add(c);
      const existing = alCriteriaToRules.get(c) ?? [];
      existing.push(v.ruleId);
      alCriteriaToRules.set(c, existing);
    }
  }

  const allCriteria = new Set([...axeWcagSet, ...alWcagSet]);
  const detail: CriterionPageResult[] = [...allCriteria].sort().map((criterion) => ({
    criterion,
    axeFound: axeWcagSet.has(criterion),
    alFound: alWcagSet.has(criterion),
    axeRuleIds: axeCriteriaToRules.get(criterion) ?? [],
    alRuleIds: alCriteriaToRules.get(criterion) ?? [],
  }));

  return {
    axeWcag: [...axeWcagSet].sort(),
    alWcag: [...alWcagSet].sort(),
    detail,
  };
}

/** Audit a single site with both axe-core and @accesslint/core. */
export async function auditSite(
  context: BrowserContext,
  origin: string,
  rank: number,
  timeout: number,
): Promise<SiteResult> {
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);

  try {
    await page.goto(origin, { waitUntil: "domcontentloaded", timeout });

    await page.addScriptTag({ path: AXE_PATH });
    await page.addScriptTag({ path: AL_PATH });

    const raw: BrowserAuditResult = await page.evaluate(AUDIT_CODE);
    const { axeWcag, alWcag, detail } = buildCriteriaDetail(raw);

    const axeViolationCount = raw.axeViolations.reduce((sum, v) => sum + v.nodeCount, 0);
    const alViolationCount = raw.alViolations.reduce((sum, v) => sum + v.count, 0);

    return {
      origin,
      rank,
      status: "ok",
      axeTimeMs: raw.axeTimeMs,
      alTimeMs: raw.alTimeMs,
      axeViolationCount,
      alViolationCount,
      axeWcagCriteria: axeWcag,
      alWcagCriteria: alWcag,
      criteriaDetail: detail,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    return {
      origin,
      rank,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      axeTimeMs: 0,
      alTimeMs: 0,
      axeViolationCount: 0,
      alViolationCount: 0,
      axeWcagCriteria: [],
      alWcagCriteria: [],
      criteriaDetail: [],
      timestamp: new Date().toISOString(),
    };
  } finally {
    await page.close();
  }
}
