import { resolve } from "node:path";
import type { BrowserContext } from "playwright";
import type { BrowserAuditResult, SiteResult, CriterionPageResult } from "./types.js";
import { extractAxeWcagCriteria, deduplicateOverlapping } from "./wcag-mapping.js";

const AXE_PATH = resolve("node_modules/axe-core/axe.min.js");
const AL_PATH = resolve("node_modules/@accesslint/core/dist/index.iife.js");
const IBM_PATH = resolve("node_modules/accessibility-checker-engine/ace.js");

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
  var axeStatus = "ok";
  var axeError = null;
  try {
    var axeStart = performance.now();
    var axeResults = await withTimeout(window.axe.run(document, { resultTypes: ["violations"] }), TIMEOUT);
    axeTimeMs = performance.now() - axeStart;
    axeViolations = axeResults.violations.map(function(v) {
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

  var ibmTimeMs = 0;
  var ibmViolations = [];
  var ibmStatus = "ok";
  var ibmError = null;
  var ibmRuleWcagMap = {};
  try {
    var checker = new ace.Checker();

    var guidelines = checker.getGuidelines();
    for (var gi = 0; gi < guidelines.length; gi++) {
      if (guidelines[gi].id !== "WCAG_2_2") continue;
      var checkpoints = guidelines[gi].checkpoints;
      for (var ci = 0; ci < checkpoints.length; ci++) {
        var cp = checkpoints[ci];
        var cpNum = cp.num;
        if (!cpNum) continue;
        var cpRules = cp.rules || [];
        for (var ri = 0; ri < cpRules.length; ri++) {
          var rId = cpRules[ri].id;
          if (!ibmRuleWcagMap[rId]) ibmRuleWcagMap[rId] = [];
          if (ibmRuleWcagMap[rId].indexOf(cpNum) === -1) {
            ibmRuleWcagMap[rId].push(cpNum);
          }
        }
      }
    }

    var origLog = console.log;
    console.log = function() {};
    var ibmStart = performance.now();
    var ibmReport = await withTimeout(checker.check(document, ["WCAG_2_2"]), TIMEOUT);
    ibmTimeMs = performance.now() - ibmStart;
    console.log = origLog;

    var ibmViolMap = {};
    for (var vi = 0; vi < ibmReport.results.length; vi++) {
      var issue = ibmReport.results[vi];
      if (issue.value[0] === "VIOLATION" && issue.value[1] === "FAIL") {
        if (!ibmViolMap[issue.ruleId]) {
          ibmViolMap[issue.ruleId] = { ruleId: issue.ruleId, count: 0 };
        }
        ibmViolMap[issue.ruleId].count++;
      }
    }
    ibmViolations = Object.values(ibmViolMap);
  } catch (e) {
    console.log = origLog || console.log;
    ibmTimeMs = -1;
    ibmStatus = "error";
    ibmError = e instanceof Error ? e.message : String(e);
  }

  return {
    domElementCount: domElementCount,
    axeTimeMs: axeTimeMs,
    alTimeMs: alTimeMs,
    ibmTimeMs: ibmTimeMs,
    axeStatus: axeStatus,
    alStatus: alStatus,
    ibmStatus: ibmStatus,
    axeError: axeError,
    alError: alError,
    ibmError: ibmError,
    axeViolations: axeViolations,
    alViolations: alViolations,
    ibmViolations: ibmViolations,
    alRuleWcagMap: alRuleWcagMap,
    ibmRuleWcagMap: ibmRuleWcagMap
  };
})()`;
}

/** Map raw browser results to WCAG criteria and build per-criterion detail. */
function buildCriteriaDetail(
  raw: BrowserAuditResult,
): {
  axeWcag: string[];
  alWcag: string[];
  ibmWcag: string[];
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

  const ibmWcagSet = new Set<string>();
  const ibmCriteriaToRules = new Map<string, string[]>();
  const ibmCriteriaNodeCount = new Map<string, number>();
  for (const v of raw.ibmViolations) {
    const criteria = raw.ibmRuleWcagMap[v.ruleId] ?? [];
    for (const c of criteria) {
      ibmWcagSet.add(c);
      const existing = ibmCriteriaToRules.get(c) ?? [];
      existing.push(v.ruleId);
      ibmCriteriaToRules.set(c, existing);
      ibmCriteriaNodeCount.set(c, (ibmCriteriaNodeCount.get(c) ?? 0) + v.count);
    }
  }

  const allCriteria = new Set([...axeWcagSet, ...alWcagSet, ...ibmWcagSet]);
  const detail: CriterionPageResult[] = [...allCriteria].sort().map((criterion) => ({
    criterion,
    axeFound: axeWcagSet.has(criterion),
    alFound: alWcagSet.has(criterion),
    ibmFound: ibmWcagSet.has(criterion),
    axeRuleIds: axeCriteriaToRules.get(criterion) ?? [],
    alRuleIds: alCriteriaToRules.get(criterion) ?? [],
    ibmRuleIds: ibmCriteriaToRules.get(criterion) ?? [],
    axeNodeCount: axeCriteriaNodeCount.get(criterion) ?? 0,
    alNodeCount: alCriteriaNodeCount.get(criterion) ?? 0,
    ibmNodeCount: ibmCriteriaNodeCount.get(criterion) ?? 0,
  }));

  return {
    axeWcag: [...axeWcagSet].sort(),
    alWcag: [...alWcagSet].sort(),
    ibmWcag: [...ibmWcagSet].sort(),
    detail,
  };
}

/** Audit a single site with axe-core, @accesslint/core, and IBM Equal Access. */
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
      await page.addScriptTag({ path: IBM_PATH });

      const raw: BrowserAuditResult = await page.evaluate(buildAuditCode(timeout));
      const { axeWcag, alWcag, ibmWcag, detail } = buildCriteriaDetail(raw);

      const axeViolationCount = raw.axeViolations.reduce((sum, v) => sum + v.nodeCount, 0);
      const alViolationCount = raw.alViolations.reduce((sum, v) => sum + v.count, 0);
      const ibmViolationCount = raw.ibmViolations.reduce((sum, v) => sum + v.count, 0);

      return {
        origin,
        rank,
        status: "ok",
        domElementCount: raw.domElementCount,
        axeTimeMs: raw.axeTimeMs,
        alTimeMs: raw.alTimeMs,
        ibmTimeMs: raw.ibmTimeMs,
        axeStatus: raw.axeStatus,
        alStatus: raw.alStatus,
        ibmStatus: raw.ibmStatus,
        axeError: raw.axeError,
        alError: raw.alError,
        ibmError: raw.ibmError,
        axeViolationCount,
        alViolationCount,
        ibmViolationCount,
        axeWcagCriteria: axeWcag,
        alWcagCriteria: alWcag,
        ibmWcagCriteria: ibmWcag,
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
      ibmTimeMs: 0,
      axeStatus: "error",
      alStatus: "error",
      ibmStatus: "error",
      axeError: null,
      alError: null,
      ibmError: null,
      axeViolationCount: 0,
      alViolationCount: 0,
      ibmViolationCount: 0,
      axeWcagCriteria: [],
      alWcagCriteria: [],
      ibmWcagCriteria: [],
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
