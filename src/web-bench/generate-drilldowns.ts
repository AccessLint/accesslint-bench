#!/usr/bin/env tsx
/**
 * Generate per-criterion drilldown pages for the benchmarks site.
 *
 * Reads results/web-bench.jsonl, buckets sites per WCAG criterion,
 * selects representative examples, and writes one static HTML page
 * per criterion into the core repo's gh-pages branch.
 *
 * Usage:
 *   npx tsx src/web-bench/generate-drilldowns.ts [--input FILE] [--output-dir DIR]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateConcordance } from "./concordance.js";
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

interface BucketSite {
  origin: string;
  rank: number;
  detail: CriterionPageResult;
}

interface RuleFrequency {
  ruleId: string;
  count: number;
}

function parseArgs(): { input: string; outputDir: string } {
  const args = process.argv.slice(2);
  let input = "results/web-bench.jsonl";
  let outputDir = "../core/benches/criteria";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--input" && args[i + 1]) {
      input = args[++i];
    } else if (args[i] === "--output-dir" && args[i + 1]) {
      outputDir = args[++i];
    }
  }

  return { input, outputDir };
}

function selectExamples(sites: BucketSite[], max: number): BucketSite[] {
  if (sites.length <= max) return sites;

  // Group by primary rule ID for diversity
  const groups = new Map<string, BucketSite[]>();
  for (const site of sites) {
    const key =
      [...site.detail.axeRuleIds, ...site.detail.alRuleIds, ...site.detail.ibmRuleIds][0] ?? "unknown";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(site);
  }

  // Sort each group by rank ascending (popular sites first)
  for (const group of groups.values()) {
    group.sort((a, b) => a.rank - b.rank);
  }

  // Round-robin across groups
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
  tool: "axe" | "al" | "ibm",
): RuleFrequency[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    const ruleIds =
      tool === "axe" ? site.detail.axeRuleIds : tool === "al" ? site.detail.alRuleIds : site.detail.ibmRuleIds;
    for (const id of ruleIds) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([ruleId, count]) => ({ ruleId, count }))
    .sort((a, b) => b.count - a.count);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderExampleTable(
  label: string,
  sites: BucketSite[],
  totalCount: number,
): string {
  if (totalCount === 0) {
    return `<h3>${escapeHtml(label)}: 0 sites</h3>\n<p>No sites in this bucket.</p>`;
  }

  const rows = sites
    .map((s) => {
      const d = s.detail;
      return `          <tr>
            <td>${escapeHtml(s.origin)}</td>
            <td>${d.axeRuleIds.join(", ") || "&mdash;"}</td>
            <td>${d.axeNodeCount}</td>
            <td>${d.alRuleIds.join(", ") || "&mdash;"}</td>
            <td>${d.alNodeCount}</td>
            <td>${d.ibmRuleIds.join(", ") || "&mdash;"}</td>
            <td>${d.ibmNodeCount}</td>
          </tr>`;
    })
    .join("\n");

  const moreNote =
    totalCount > sites.length
      ? `\n    <p>${totalCount - sites.length} more not shown.</p>`
      : "";

  const sitesWord = totalCount === 1 ? "site" : "sites";

  return `    <h3>${escapeHtml(label)}: ${totalCount} ${sitesWord}</h3>
    <div class="bench-table-wrap" tabindex="0" role="region" aria-label="${escapeHtml(label)} examples">
      <table class="bench-table">
        <thead>
          <tr>
            <th>Site</th>
            <th>axe rules</th>
            <th>axe nodes</th>
            <th>@accesslint/core rules</th>
            <th>@accesslint/core nodes</th>
            <th>IBM EA rules</th>
            <th>IBM EA nodes</th>
          </tr>
        </thead>
        <tbody>
${rows}
        </tbody>
      </table>
    </div>${moreNote}`;
}

function renderRulesTable(
  axeRules: RuleFrequency[],
  alRules: RuleFrequency[],
  ibmRules: RuleFrequency[],
): string {
  if (axeRules.length === 0 && alRules.length === 0 && ibmRules.length === 0) return "";

  const maxRows = Math.max(axeRules.length, alRules.length, ibmRules.length);
  const rows: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    const axe = axeRules[i];
    const al = alRules[i];
    const ibm = ibmRules[i];
    rows.push(`          <tr>
            <td>${axe ? escapeHtml(axe.ruleId) : ""}</td>
            <td>${axe ? axe.count : ""}</td>
            <td>${al ? escapeHtml(al.ruleId) : ""}</td>
            <td>${al ? al.count : ""}</td>
            <td>${ibm ? escapeHtml(ibm.ruleId) : ""}</td>
            <td>${ibm ? ibm.count : ""}</td>
          </tr>`);
  }

  return `    <h2>Rules</h2>
    <p>Which rule IDs fire for this criterion and how many sites they appear on.</p>
    <div class="bench-table-wrap" tabindex="0" role="region" aria-label="Rule frequency comparison">
      <table class="bench-table">
        <thead>
          <tr>
            <th>axe rule</th>
            <th>Sites</th>
            <th>@accesslint/core rule</th>
            <th>Sites</th>
            <th>IBM EA rule</th>
            <th>Sites</th>
          </tr>
        </thead>
        <tbody>
${rows.join("\n")}
        </tbody>
      </table>
    </div>`;
}

function buildRuleChartData(
  axeRules: RuleFrequency[],
  alRules: RuleFrequency[],
  ibmRules: RuleFrequency[],
  topN = 10,
) {
  return {
    axe: axeRules.slice(0, topN),
    al: alRules.slice(0, topN),
    ibm: ibmRules.slice(0, topN),
  };
}

function renderPage(
  criterion: string,
  name: string,
  concordance: { allThree: number; twoOfThree: number; oneOnly: number; noneFound: number },
  axeRules: RuleFrequency[],
  alRules: RuleFrequency[],
  ibmRules: RuleFrequency[],
  allThreeExamples: BucketSite[],
  allThreeTotal: number,
  twoOfThreeExamples: BucketSite[],
  twoOfThreeTotal: number,
  axeOnlyExamples: BucketSite[],
  axeOnlyTotal: number,
  alOnlyExamples: BucketSite[],
  alOnlyTotal: number,
  ibmOnlyExamples: BucketSite[],
  ibmOnlyTotal: number,
): string {
  const title = `WCAG ${criterion}: ${name}`;
  const totalDetected = concordance.allThree + concordance.twoOfThree + concordance.oneOnly;

  const agreementData = JSON.stringify({
    allThree: concordance.allThree,
    twoOfThree: concordance.twoOfThree,
    oneOnly: concordance.oneOnly,
  });

  const rulesData = JSON.stringify(buildRuleChartData(axeRules, alRules, ibmRules));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — a11y agent</title>
<meta name="description" content="${escapeHtml(title)}: comparison of axe-core, @accesslint/core, and IBM Equal Access detection across sites.">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>

<header>
  <nav class="site-nav" aria-label="Main">
    <a class="logo" href="/benches/">@accesslint/core</a>
    <ul>
      <li><a href="/benches/" aria-current="true">Benchmarks</a></li>
      <li><a href="https://github.com/accesslint/core">GitHub</a></li>
      <li><a href="https://a11yagent.ai">a11y agent</a></li>
      <li><a href="https://app.accesslint.com">CI</a></li>
    </ul>
  </nav>
</header>

<main id="main">
  <article class="section prose">
    <h1>${escapeHtml(title)}</h1>

    <dl class="bench-stats">
      <div>
        <dt>${concordance.allThree.toLocaleString()}</dt>
        <dd>all three tools</dd>
      </div>
      <div>
        <dt>${concordance.twoOfThree.toLocaleString()}</dt>
        <dd>two of three</dd>
      </div>
      <div>
        <dt>${concordance.oneOnly.toLocaleString()}</dt>
        <dd>one tool only</dd>
      </div>
      <div>
        <dt>${totalDetected.toLocaleString()}</dt>
        <dd>any tool</dd>
      </div>
    </dl>
    <div id="chart-agreement"></div>

${renderRulesTable(axeRules, alRules, ibmRules)}
    <div id="chart-rules"></div>

    <h2>Examples</h2>

${renderExampleTable("All three", allThreeExamples, allThreeTotal)}

${renderExampleTable("Two of three", twoOfThreeExamples, twoOfThreeTotal)}

${renderExampleTable("axe-only", axeOnlyExamples, axeOnlyTotal)}

${renderExampleTable("@accesslint/core only", alOnlyExamples, alOnlyTotal)}

${renderExampleTable("IBM EA only", ibmOnlyExamples, ibmOnlyTotal)}

    <p><a href="/benches/">&larr; Back to benchmarks</a></p>

    <p class="bench-updated">Last updated <time datetime="${new Date().toISOString().slice(0, 10)}">${new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</time></p>
  </article>
</main>

<footer class="site-footer">
  <p>Built by <a href="https://github.com/accesslint">AccessLint</a>. MIT License.</p>
</footer>

<script type="application/json" id="chart-data-agreement">${agreementData}</script>
<script type="application/json" id="chart-data-rules">${rulesData}</script>
<script src="https://code.highcharts.com/highcharts.js" defer></script>
<script src="https://code.highcharts.com/modules/accessibility.js" defer></script>
<script src="/benches/charts.js" defer></script>
</body>
</html>
`;
}

// --- Main ---

const { input, outputDir } = parseArgs();

const lines = readFileSync(input, "utf-8").split("\n").filter(Boolean);
const results: SiteResult[] = lines.map((l) => JSON.parse(l));
const ok = results.filter((r) => r.status === "ok");

console.log(`Loaded ${results.length} results (${ok.length} OK)`);

const concordances = calculateConcordance(results);
const concordanceMap = new Map(concordances.map((c) => [c.criterion, c]));

for (const [criterion, name] of Object.entries(CRITERIA)) {
  const conc = concordanceMap.get(criterion);
  if (!conc) {
    console.warn(`No concordance data for ${criterion}, skipping`);
    continue;
  }

  // Bucket sites
  const allThreeSites: BucketSite[] = [];
  const twoOfThreeSites: BucketSite[] = [];
  const axeOnly: BucketSite[] = [];
  const alOnly: BucketSite[] = [];
  const ibmOnly: BucketSite[] = [];

  for (const r of ok) {
    const detail = r.criteriaDetail.find((d) => d.criterion === criterion);
    const axeHas = r.axeWcagCriteria.includes(criterion);
    const alHas = r.alWcagCriteria.includes(criterion);
    const ibmHas = (r.ibmWcagCriteria ?? []).includes(criterion);

    const count = (axeHas ? 1 : 0) + (alHas ? 1 : 0) + (ibmHas ? 1 : 0);
    const fallbackDetail: CriterionPageResult = {
      criterion,
      axeFound: axeHas,
      alFound: alHas,
      ibmFound: ibmHas,
      axeRuleIds: [],
      alRuleIds: [],
      ibmRuleIds: [],
      axeNodeCount: 0,
      alNodeCount: 0,
      ibmNodeCount: 0,
    };

    if (count === 3) {
      allThreeSites.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    } else if (count === 2) {
      twoOfThreeSites.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    } else if (axeHas) {
      axeOnly.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    } else if (alHas) {
      alOnly.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    } else if (ibmHas) {
      ibmOnly.push({ origin: r.origin, rank: r.rank, detail: detail ?? fallbackDetail });
    }
  }

  // Sort by rank ascending
  for (const bucket of [allThreeSites, twoOfThreeSites, axeOnly, alOnly, ibmOnly]) {
    bucket.sort((a, b) => a.rank - b.rank);
  }

  // Compute rule frequencies from ALL sites (not just examples)
  const allSitesForCriterion = [...allThreeSites, ...twoOfThreeSites, ...axeOnly, ...alOnly, ...ibmOnly];
  const axeRules = computeRuleFrequencies(allSitesForCriterion, "axe");
  const alRules = computeRuleFrequencies(allSitesForCriterion, "al");
  const ibmRules = computeRuleFrequencies(allSitesForCriterion, "ibm");

  // Select examples
  const allThreeExamples = selectExamples(allThreeSites, 10);
  const twoOfThreeExamples = selectExamples(twoOfThreeSites, 10);
  const axeOnlyExamples = selectExamples(axeOnly, 10);
  const alOnlyExamples = selectExamples(alOnly, 10);
  const ibmOnlyExamples = selectExamples(ibmOnly, 10);

  // Write HTML
  const dir = resolve(outputDir, criterion);
  mkdirSync(dir, { recursive: true });
  const html = renderPage(
    criterion,
    name,
    conc,
    axeRules,
    alRules,
    ibmRules,
    allThreeExamples,
    allThreeSites.length,
    twoOfThreeExamples,
    twoOfThreeSites.length,
    axeOnlyExamples,
    axeOnly.length,
    alOnlyExamples,
    alOnly.length,
    ibmOnlyExamples,
    ibmOnly.length,
  );
  writeFileSync(resolve(dir, "index.html"), html);
  console.log(`  ${criterion} ${name} → ${dir}/index.html`);
}

console.log("Done.");
