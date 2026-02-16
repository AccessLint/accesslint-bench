#!/usr/bin/env tsx
/**
 * Generate the benchmarks landing page (benches/index.html).
 *
 * Reads results/web-bench.jsonl, computes stats and concordance,
 * embeds chart data for Highcharts, and writes a fully data-driven page.
 *
 * Usage:
 *   npx tsx src/web-bench/generate-index.ts [--input FILE] [--output-dir DIR]
 */
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { calculateConcordance } from "./concordance.js";
import type { SiteResult, CriterionConcordance } from "./types.js";

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
  let outputDir = "../core/benches";

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

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildSpeedChartData(ok: SiteResult[]) {
  const axeMedian = Math.round(median(ok.map((r) => r.axeTimeMs)));
  const alMedian = Math.round(median(ok.map((r) => r.alTimeMs)));
  const ibmMedian = Math.round(median(ok.map((r) => r.ibmTimeMs)));

  // Sort by duration descending
  const tools = [
    { name: "IBM EA", value: ibmMedian, color: "#be95ff" },
    { name: "axe-core", value: axeMedian, color: "#555555" },
    { name: "@accesslint/core", value: alMedian, color: "#0055cc" },
  ].sort((a, b) => b.value - a.value);

  return {
    categories: tools.map((t) => t.name),
    values: tools.map((t) => t.value),
    colors: tools.map((t) => t.color),
  };
}

interface AlCoverageStat {
  criterion: string;
  alDetects: number;
  confirmedByAxe: number;
  confirmedByIBM: number;
  alUnique: number;
  bothConfirm: number;
  axeOnlyConfirms: number;
  ibmOnlyConfirms: number;
}

function computeAlCoverage(ok: SiteResult[]): AlCoverageStat[] {
  const stats: AlCoverageStat[] = [];

  for (const criterion of Object.keys(CRITERIA)) {
    let alDetects = 0, confirmedByAxe = 0, confirmedByIBM = 0, alUnique = 0;
    let bothConfirm = 0, axeOnlyConfirms = 0, ibmOnlyConfirms = 0;

    for (const r of ok) {
      const alHas = r.alWcagCriteria.includes(criterion);
      if (!alHas) continue;
      alDetects++;
      const axeHas = r.axeWcagCriteria.includes(criterion);
      const ibmHas = (r.ibmWcagCriteria ?? []).includes(criterion);
      if (axeHas) confirmedByAxe++;
      if (ibmHas) confirmedByIBM++;
      if (axeHas && ibmHas) bothConfirm++;
      else if (axeHas) axeOnlyConfirms++;
      else if (ibmHas) ibmOnlyConfirms++;
      else alUnique++;
    }

    stats.push({ criterion, alDetects, confirmedByAxe, confirmedByIBM, alUnique, bothConfirm, axeOnlyConfirms, ibmOnlyConfirms });
  }

  return stats.sort((a, b) => b.alDetects - a.alDetects);
}

function buildConcordanceChartData(stats: AlCoverageStat[]) {
  return {
    categories: stats.map((s) => `${s.criterion} ${CRITERIA[s.criterion] ?? ""}`),
    bothConfirm: stats.map((s) => s.bothConfirm),
    axeConfirms: stats.map((s) => s.axeOnlyConfirms),
    ibmConfirms: stats.map((s) => s.ibmOnlyConfirms),
    alUnique: stats.map((s) => s.alUnique),
  };
}

function buildKappaChartData(concordances: CriterionConcordance[]) {
  // Mean kappa across all criteria
  const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const axeAlMean = mean(concordances.map((c) => c.axeAlKappa));
  const axeIbmMean = mean(concordances.map((c) => c.axeIbmKappa));
  const alIbmMean = mean(concordances.map((c) => c.alIbmKappa));

  const labels = ["axe-core", "@accesslint/core", "IBM EA"];
  // data: [x, y, value] — symmetric matrix
  const data = [
    [0, 0, 1],
    [0, 1, +axeAlMean.toFixed(2)],
    [0, 2, +axeIbmMean.toFixed(2)],
    [1, 0, +axeAlMean.toFixed(2)],
    [1, 1, 1],
    [1, 2, +alIbmMean.toFixed(2)],
    [2, 0, +axeIbmMean.toFixed(2)],
    [2, 1, +alIbmMean.toFixed(2)],
    [2, 2, 1],
  ];

  return { labels, data };
}

function renderCoverageRow(s: AlCoverageStat): string {
  const name = CRITERIA[s.criterion];
  if (!name) return "";
  return `          <tr>
            <td><a href="/benches/criteria/${s.criterion}/">${s.criterion} ${escapeHtml(name)}</a></td>
            <td>${s.alDetects.toLocaleString()}</td>
            <td>${s.confirmedByAxe.toLocaleString()}</td>
            <td>${s.confirmedByIBM.toLocaleString()}</td>
            <td>${s.alUnique.toLocaleString()}</td>
          </tr>`;
}

function renderPage(
  ok: SiteResult[],
  alCoverage: AlCoverageStat[],
  concordances: CriterionConcordance[],
  totalSites: number,
): string {
  const axeMedian = Math.round(median(ok.map((r) => r.axeTimeMs)));
  const alMedian = Math.round(median(ok.map((r) => r.alTimeMs)));
  const ibmMedian = Math.round(median(ok.map((r) => r.ibmTimeMs)));
  const axeSpeedup = axeMedian > 0 ? Math.round(axeMedian / alMedian) : 1;
  const ibmSpeedup = ibmMedian > 0 ? Math.round(ibmMedian / alMedian) : 1;

  // Confirmation rate
  const totalAlDetects = alCoverage.reduce((s, c) => s + c.alDetects, 0);
  const totalConfirmed = alCoverage.reduce((s, c) => s + c.alDetects - c.alUnique, 0);
  const confirmationPct = totalAlDetects > 0 ? Math.round((totalConfirmed / totalAlDetects) * 100) : 0;

  const coverageRows = alCoverage.map(renderCoverageRow).filter(Boolean).join("\n");

  const speedData = JSON.stringify(buildSpeedChartData(ok));
  const concordanceData = JSON.stringify(buildConcordanceChartData(alCoverage));
  const kappaData = JSON.stringify(buildKappaChartData(concordances));

  const dateIso = new Date().toISOString().slice(0, 10);
  const dateHuman = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Benchmarks — a11y agent</title>
<meta name="description" content="axe-core vs @accesslint/core vs IBM Equal Access benchmarks tested against ${totalSites.toLocaleString()} sites from the Chrome UX Report.">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>

<header>
  <nav class="site-nav" aria-label="Main">
    <a class="logo" href="/benches/">@accesslint/core</a>
    <ul>
      <li><a href="/benches/" aria-current="page">Benchmarks</a></li>
      <li><a href="https://github.com/accesslint/core">GitHub</a></li>
      <li><a href="https://a11yagent.ai">a11y agent</a></li>
      <li><a href="https://app.accesslint.com">CI</a></li>
    </ul>
  </nav>
</header>

<main id="main">
  <section class="section">
    <h1>Benchmarks</h1>
    <p>axe-core vs <code>@accesslint/core</code> vs IBM Equal Access, tested against ${totalSites.toLocaleString()} sites from the Chrome UX Report.</p>

    <h2>Speed</h2>
    <p>Median audit time across ${ok.length.toLocaleString()} successful site audits.</p>
    <div id="chart-speed"></div>

    <h2>Coverage</h2>
    <p>What <code>@accesslint/core</code> detects and how often other tools agree. ${confirmationPct}% of detections are confirmed by at least one other tool. Click a criterion to see examples.</p>
    <div class="bench-table-wrap">
      <table class="bench-table">
        <thead>
          <tr>
            <th>WCAG Criterion</th>
            <th>@accesslint/core detects</th>
            <th>axe confirms</th>
            <th>IBM confirms</th>
            <th>Unique</th>
          </tr>
        </thead>
        <tbody>
${coverageRows}
        </tbody>
      </table>
    </div>
    <div id="chart-concordance"></div>

    <h2>Inter-rater Agreement</h2>
    <p>Mean Cohen&rsquo;s kappa (κ) across all criteria. Values above 0.6 indicate substantial agreement.</p>
    <div id="chart-kappa"></div>

    <h2>Key findings</h2>
    <ul class="bench-takeaways">
      <li><code>@accesslint/core</code> is <strong>${axeSpeedup}&times; faster</strong> than axe-core and <strong>${ibmSpeedup}&times; faster</strong> than IBM EA at median</li>
      <li><strong>${confirmationPct}%</strong> of <code>@accesslint/core</code> detections are confirmed by at least one other tool</li>
      <li>Near-perfect agreement with axe-core on link-name, resize-text, and language-of-page</li>
    </ul>

    <h2>Methodology</h2>
    <ul class="bench-methodology">
      <li><strong>Sample</strong>: ${totalSites.toLocaleString()} origins from the <a href="https://developer.chrome.com/docs/crux">Chrome UX Report</a>, seeded random sample</li>
      <li><strong>Runner</strong>: Chromium via <a href="https://playwright.dev">Playwright</a>, headless, on GitHub Actions (<code>ubuntu-latest</code>)</li>
      <li><strong>axe-core</strong>: default configuration (no custom rules enabled). Only violations are compared</li>
      <li><strong><code>@accesslint/core</code></strong>: latest, default configuration</li>
      <li><strong>IBM Equal Access</strong>: latest, default configuration</li>
      <li><strong>Per-site timeout</strong>: 15 s (navigation + audit), 5 concurrent pages per shard, 20 shards</li>
      <li><strong>Source</strong>: <a href="https://github.com/accesslint/accesslint-bench">accesslint/accesslint-bench</a></li>
    </ul>

    <p class="bench-updated">Last updated <time datetime="${dateIso}">${dateHuman}</time></p>
  </section>
</main>

<footer class="site-footer">
  <p>Built by <a href="https://github.com/accesslint">AccessLint</a>. MIT License.</p>
</footer>

<script type="application/json" id="chart-data-speed">${speedData}</script>
<script type="application/json" id="chart-data-concordance">${concordanceData}</script>
<script type="application/json" id="chart-data-kappa">${kappaData}</script>
<script src="https://code.highcharts.com/highcharts.js" defer></script>
<script src="https://code.highcharts.com/highcharts-more.js" defer></script>
<script src="https://code.highcharts.com/modules/heatmap.js" defer></script>
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
const totalSites = results.length;

console.log(`Loaded ${results.length} results (${ok.length} OK)`);

const concordances = calculateConcordance(results);
const alCoverage = computeAlCoverage(ok);

mkdirSync(resolve(outputDir), { recursive: true });
const html = renderPage(ok, alCoverage, concordances, totalSites);
writeFileSync(resolve(outputDir, "index.html"), html);
console.log(`  index.html → ${outputDir}/index.html`);
console.log("Done.");
