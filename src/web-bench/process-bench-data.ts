#!/usr/bin/env tsx
/**
 * Process benchmark JSONL into JSON data files for the Astro site.
 *
 * Reads results/web-bench.jsonl, computes stats and
 * per-criterion drilldown data, and writes:
 *   - summary.json        (index page data)
 *   - criteria/<C>.json   (one per WCAG criterion)
 *
 * Usage:
 *   npx tsx src/web-bench/process-bench-data.ts [--input FILE] [--output-dir DIR]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { SiteResult, CriterionPageResult } from "./types.js";

const CRITERIA: Record<string, string> = {
  "4.1.2": "Name, Role, Value",
  "1.4.3": "Contrast (Minimum)",
  "2.4.4": "Link Purpose (In Context)",
  "1.1.1": "Non-text Content",
  "1.4.4": "Resize Text",
  "1.3.1": "Info and Relationships",
  "3.1.1": "Language of Page",
  "2.1.1": "Keyboard",
};

function parseArgs(): { input: string; outputDir: string } {
  const args = process.argv.slice(2);
  let input = "results/web-bench.jsonl";
  let outputDir = "bench-data";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      input = args[++i];
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = args[++i];
    }
  }

  return { input, outputDir };
}

function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function safeMedian(values: (number | undefined | null)[]): number | null {
  const valid = values.filter((v): v is number => v != null && v > 0);
  return valid.length > 0 ? Math.round(median(valid)) : null;
}

// --- AL coverage ---

interface AlCoverageStat {
  criterion: string;
  name: string;
  alDetects: number;
  confirmedByAxe: number;
  alUnique: number;
}

function computeAlCoverage(ok: SiteResult[]): AlCoverageStat[] {
  const stats: AlCoverageStat[] = [];

  for (const [criterion, name] of Object.entries(CRITERIA)) {
    let alDetects = 0, confirmedByAxe = 0, alUnique = 0;

    for (const r of ok) {
      const alHas = r.alWcagCriteria.includes(criterion);
      if (!alHas) continue;
      alDetects++;
      const axeHas = r.axeWcagCriteria.includes(criterion);
      if (axeHas) confirmedByAxe++;
      else alUnique++;
    }

    stats.push({ criterion, name, alDetects, confirmedByAxe, alUnique });
  }

  return stats.sort((a, b) => b.alDetects - a.alDetects);
}

// --- Speed chart data ---

function buildSpeedChartData(ok: SiteResult[]) {
  const allTools = [
    { name: "axe-core", value: safeMedian(ok.map((r) => r.axeTimeMs)), color: "#555555" },
    { name: "@accesslint/core", value: safeMedian(ok.map((r) => r.alTimeMs)), color: "#0055cc" },
  ];

  const tools = allTools.filter((t) => t.value != null).sort((a, b) => b.value! - a.value!);

  return {
    categories: tools.map((t) => t.name),
    values: tools.map((t) => t.value),
    colors: tools.map((t) => t.color),
  };
}

// --- Concordance chart data ---

function buildConcordanceChartData(stats: AlCoverageStat[]) {
  return {
    categories: stats.map((s) => `${s.criterion} ${s.name}`),
    axeConfirms: stats.map((s) => s.confirmedByAxe),
    alUnique: stats.map((s) => s.alUnique),
  };
}

// --- Drilldown data ---

interface BucketSite {
  origin: string;
  rank: number;
  detail: CriterionPageResult;
}

interface RuleFrequency {
  ruleId: string;
  count: number;
}

function selectExamples(sites: BucketSite[], max: number): BucketSite[] {
  if (sites.length <= max) return sites;

  const groups = new Map<string, BucketSite[]>();
  for (const site of sites) {
    const key =
      [...(site.detail.axeRuleIds ?? []), ...(site.detail.alRuleIds ?? [])][0] ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(site);
  }

  for (const group of groups.values()) {
    group.sort((a, b) => a.rank - b.rank);
  }

  const selected: BucketSite[] = [];
  const iterators = [...groups.values()].map((g) => ({ items: g, idx: 0 }));
  while (selected.length < max) {
    let added = false;
    for (const it of iterators) {
      if (selected.length >= max) break;
      if (it.idx < it.items.length) {
        selected.push(it.items[it.idx++]);
        added = true;
      }
    }
    if (!added) break;
  }

  return selected;
}

function computeRuleFrequencies(
  sites: BucketSite[],
  tool: "axe" | "al",
): RuleFrequency[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    const ruleIds = tool === "axe" ? site.detail.axeRuleIds : site.detail.alRuleIds;
    for (const id of ruleIds ?? []) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count);
}

function toExample(site: BucketSite) {
  return {
    origin: site.origin,
    axeRuleIds: site.detail.axeRuleIds ?? [],
    axeNodeCount: site.detail.axeNodeCount ?? 0,
    alRuleIds: site.detail.alRuleIds ?? [],
    alNodeCount: site.detail.alNodeCount ?? 0,
  };
}

// --- Main ---

const { input, outputDir } = parseArgs();

const lines = readFileSync(input, "utf-8").split("\n").filter(Boolean);
const results: SiteResult[] = lines.map((l) => JSON.parse(l));
const ok = results.filter((r) => r.status === "ok");
const totalSites = results.length;

console.log(`Loaded ${results.length} results (${ok.length} OK)`);

const alCoverage = computeAlCoverage(ok);

// Compute summary stats
const axeMedian = safeMedian(ok.map((r) => r.axeTimeMs));
const alMedian = safeMedian(ok.map((r) => r.alTimeMs));
const axeSpeedup = axeMedian && alMedian ? Math.round(axeMedian / alMedian) : null;

const totalAlDetects = alCoverage.reduce((s, c) => s + c.alDetects, 0);
const totalConfirmed = alCoverage.reduce((s, c) => s + c.confirmedByAxe, 0);
const confirmationPct = totalAlDetects > 0 ? Math.round((totalConfirmed / totalAlDetects) * 100) : 0;

const dateIso = new Date().toISOString().slice(0, 10);

// Write summary.json
const summary = {
  totalSites,
  okSites: ok.length,
  axeMedian,
  alMedian,
  axeSpeedup,
  confirmationPct,
  dateIso,
  coverage: alCoverage,
  speedChart: buildSpeedChartData(ok),
  concordanceChart: buildConcordanceChartData(alCoverage),
};

mkdirSync(resolve(outputDir), { recursive: true });
mkdirSync(resolve(outputDir, "criteria"), { recursive: true });

writeFileSync(resolve(outputDir, "summary.json"), JSON.stringify(summary, null, 2));
console.log(`  summary.json → ${outputDir}/summary.json`);

// Write per-criterion JSON
for (const [criterion, name] of Object.entries(CRITERIA)) {
  const bothSites: BucketSite[] = [];
  const axeOnly: BucketSite[] = [];
  const alOnly: BucketSite[] = [];

  for (const r of ok) {
    const detail = r.criteriaDetail.find((d) => d.criterion === criterion);
    const axeHas = r.axeWcagCriteria.includes(criterion);
    const alHas = r.alWcagCriteria.includes(criterion);

    const fallbackDetail: CriterionPageResult = {
      criterion,
      axeFound: axeHas,
      alFound: alHas,
      ibmFound: false,
      axeRuleIds: [],
      alRuleIds: [],
      ibmRuleIds: [],
      axeNodeCount: 0,
      alNodeCount: 0,
      ibmNodeCount: 0,
    };

    if (axeHas && alHas) {
      bothSites.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    } else if (axeHas) {
      axeOnly.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    } else if (alHas) {
      alOnly.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    }
  }

  for (const bucket of [bothSites, axeOnly, alOnly]) {
    bucket.sort((a, b) => a.rank - b.rank);
  }

  const allSitesForCriterion = [...bothSites, ...axeOnly, ...alOnly];
  const axeRules = computeRuleFrequencies(allSitesForCriterion, "axe");
  const alRules = computeRuleFrequencies(allSitesForCriterion, "al");

  const criterionData = {
    criterion,
    name,
    concordance: {
      both: bothSites.length,
      axeOnly: axeOnly.length,
      alOnly: alOnly.length,
    },
    rules: {
      axe: axeRules.slice(0, 10),
      al: alRules.slice(0, 10),
    },
    examples: {
      both: { total: bothSites.length, items: selectExamples(bothSites, 10).map(toExample) },
      axeOnly: { total: axeOnly.length, items: selectExamples(axeOnly, 10).map(toExample) },
      alOnly: { total: alOnly.length, items: selectExamples(alOnly, 10).map(toExample) },
    },
  };

  writeFileSync(resolve(outputDir, "criteria", `${criterion}.json`), JSON.stringify(criterionData, null, 2));
  console.log(`  ${criterion} ${name} → ${outputDir}/criteria/${criterion}.json`);
}

console.log("Done.");
