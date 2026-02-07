import { resolve } from "node:path";
import type { BrowserContext } from "playwright";
import type { BrowserAuditResult, SiteResult, CriterionPageResult } from "./types.js";
import { extractAxeWcagCriteria, deduplicateOverlapping } from "./wcag-mapping.js";

const AXE_PATH = resolve("node_modules/axe-core/axe.min.js");
const AL_PATH = resolve("node_modules/@accesslint/core/dist/index.iife.js");

/**
 * Browser-side audit code injected via page.evaluate (as a string to
 * avoid tsx __name transforms).
 */
function buildAuditCode(timeout: number): string {
  // Cap the in-page audit at 80% of the per-site timeout to leave room for navigation
  const auditTimeout = Math.round(timeout * 0.8);
  return `(async () => {
  var TIMEOUT = ${auditTimeout};

  function withTimeout(promise, ms) {
    return Promise.race([
      promise,
      new Promise(function(_, reject) {
        setTimeout(function() { reject(new Error("audit timeout")); }, ms);
      })
    ]);
  }

  var domElementCount = document.querySelectorAll('*').length;

  var alRuleWcagMap = {};
  if (window.AccessLintCore && window.AccessLintCore.getActiveRules) {
    var rules = window.AccessLintCore.getActiveRules();
    for (var i = 0; i < rules.length; i++) {
      alRuleWcagMap[rules[i].id] = rules[i].wcag || [];
    }
  }

  var axeTimeMs = 0;
  var axeViolations = [];
  var axeIncomplete = [];
  var axeStatus = "ok";
  var axeError = null;
  try {
    var axeStart = performance.now();
    var axeResults = await withTimeout(window.axe.run(document, { resultTypes: ["violations", "incomplete"] }), TIMEOUT);
    axeTimeMs = performance.now() - axeStart;
    axeViolations = axeResults.violations.map(function(v) {
      return { id: v.id, tags: v.tags, nodeCount: v.nodes.length, impact: v.impact };
    });
    axeIncomplete = (axeResults.incomplete || []).map(function(v) {
      return { id: v.id, tags: v.tags, nodeCount: v.nodes.length, impact: v.impact };
    });
  } catch (e) {
    axeTimeMs = -1;
    axeStatus = "error";
    axeError = e instanceof Error ? e.message : String(e);
  }

  var alTimeMs = 0;
  var alViolations = [];
  var alStatus = "ok";
  var alError = null;
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
    alStatus = "error";
    alError = e instanceof Error ? e.message : String(e);
  }

  return {
    domElementCount: domElementCount,
    axeTimeMs: axeTimeMs,
    alTimeMs: alTimeMs,
    axeStatus: axeStatus,
    alStatus: alStatus,
    axeError: axeError,
    alError: alError,
    axeViolations: axeViolations,
    axeIncomplete: axeIncomplete,
    alViolations: alViolations,
    alRuleWcagMap: alRuleWcagMap
  };
})()`;
}

/** Map raw browser results to WCAG criteria and build per-criterion detail. */
function buildCriteriaDetail(
  raw: BrowserAuditResult,
): {
  axeWcag: string[];
  alWcag: string[];
  axeIncompleteWcag: string[];
  detail: CriterionPageResult[];
} {
  const axeWcagSet = new Set<string>();
  const axeCriteriaToRules = new Map<string, string[]>();
  const axeCriteriaNodeCount = new Map<string, number>();
  for (const v of raw.axeViolations) {
    const criteria = deduplicateOverlapping(extractAxeWcagCriteria(v.tags));
    for (const c of criteria) {
      axeWcagSet.add(c);
      const existing = axeCriteriaToRules.get(c) ?? [];
      existing.push(v.id);
      axeCriteriaToRules.set(c, existing);
      axeCriteriaNodeCount.set(c, (axeCriteriaNodeCount.get(c) ?? 0) + v.nodeCount);
    }
  }

  // Collect incomplete criteria separately (e.g. bypass with reviewOnFail)
  const axeIncompleteWcagSet = new Set<string>();
  for (const v of raw.axeIncomplete) {
    for (const c of deduplicateOverlapping(extractAxeWcagCriteria(v.tags))) {
      axeIncompleteWcagSet.add(c);
    }
  }

  const alWcagSet = new Set<string>();
  const alCriteriaToRules = new Map<string, string[]>();
  const alCriteriaNodeCount = new Map<string, number>();
  for (const v of raw.alViolations) {
    const criteria = raw.alRuleWcagMap[v.ruleId] ?? [];
    for (const c of criteria) {
      alWcagSet.add(c);
      const existing = alCriteriaToRules.get(c) ?? [];
      existing.push(v.ruleId);
      alCriteriaToRules.set(c, existing);
      alCriteriaNodeCount.set(c, (alCriteriaNodeCount.get(c) ?? 0) + v.count);
    }
  }

  const allCriteria = new Set([...axeWcagSet, ...alWcagSet]);
  const detail: CriterionPageResult[] = [...allCriteria].sort().map((criterion) => ({
    criterion,
    axeFound: axeWcagSet.has(criterion),
    alFound: alWcagSet.has(criterion),
    axeRuleIds: axeCriteriaToRules.get(criterion) ?? [],
    alRuleIds: alCriteriaToRules.get(criterion) ?? [],
    axeNodeCount: axeCriteriaNodeCount.get(criterion) ?? 0,
    alNodeCount: alCriteriaNodeCount.get(criterion) ?? 0,
  }));

  return {
    axeWcag: [...axeWcagSet].sort(),
    alWcag: [...alWcagSet].sort(),
    axeIncompleteWcag: [...axeIncompleteWcagSet].sort(),
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

  // Hard deadline: if anything hangs beyond 2× the per-site timeout, force-close the page.
  const hardTimeout = timeout * 2;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      page.close({ runBeforeUnload: false }).catch(() => {});
      reject(new Error(`hard timeout after ${hardTimeout}ms`));
    }, hardTimeout);
  });

  try {
    const result = await Promise.race([deadline, (async (): Promise<SiteResult> => {
      await page.goto(origin, { waitUntil: "domcontentloaded", timeout });

      // Wait for DOM to stabilize (SPA rendering) — up to 3s hard cap
      // Uses a string to avoid tsx __name transforms on arrow functions
      await page.evaluate(`new Promise(function(resolve) {
        var lastCount = document.querySelectorAll('*').length;
        var stableFrames = 0;
        var maxWait = setTimeout(resolve, 3000);
        function check() {
          var count = document.querySelectorAll('*').length;
          if (count === lastCount) {
            stableFrames++;
            if (stableFrames >= 3) {
              clearTimeout(maxWait);
              resolve();
              return;
            }
          } else {
            stableFrames = 0;
            lastCount = count;
          }
          requestAnimationFrame(check);
        }
        requestAnimationFrame(check);
      })`);

      await page.addScriptTag({ path: AXE_PATH });
      await page.addScriptTag({ path: AL_PATH });

      const raw: BrowserAuditResult = await page.evaluate(buildAuditCode(timeout));
      const { axeWcag, alWcag, axeIncompleteWcag, detail } = buildCriteriaDetail(raw);

      const axeViolationCount = raw.axeViolations.reduce((sum, v) => sum + v.nodeCount, 0);
      const alViolationCount = raw.alViolations.reduce((sum, v) => sum + v.count, 0);
      const axeIncompleteCount = raw.axeIncomplete.reduce((sum, v) => sum + v.nodeCount, 0);

      return {
        origin,
        rank,
        status: "ok",
        domElementCount: raw.domElementCount,
        axeTimeMs: raw.axeTimeMs,
        alTimeMs: raw.alTimeMs,
        axeStatus: raw.axeStatus,
        alStatus: raw.alStatus,
        axeError: raw.axeError,
        alError: raw.alError,
        axeViolationCount,
        alViolationCount,
        axeIncompleteCount,
        axeWcagCriteria: axeWcag,
        alWcagCriteria: alWcag,
        axeIncompleteWcagCriteria: axeIncompleteWcag,
        criteriaDetail: detail,
        timestamp: new Date().toISOString(),
      };
    })()]);
    return result;
  } catch (err) {
    return {
      origin,
      rank,
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      domElementCount: 0,
      axeTimeMs: 0,
      alTimeMs: 0,
      axeStatus: "error",
      alStatus: "error",
      axeError: null,
      alError: null,
      axeViolationCount: 0,
      alViolationCount: 0,
      axeIncompleteCount: 0,
      axeWcagCriteria: [],
      alWcagCriteria: [],
      axeIncompleteWcagCriteria: [],
      criteriaDetail: [],
      timestamp: new Date().toISOString(),
    };
  } finally {
    clearTimeout(timer);
    await Promise.race([
      page.close().catch(() => {}),
      new Promise((r) => setTimeout(r, 5000)),
    ]);
  }
}
