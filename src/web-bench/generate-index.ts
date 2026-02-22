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
import { WCAG_CRITERIA_NAMES, selectTopCriteria } from "./wcag-criteria.js";

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

  // Sort by duration descending
  const tools = [
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
  alUnique: number;
}

function computeAlCoverage(ok: SiteResult[], criteria: Record<string, string>): AlCoverageStat[] {
  const stats: AlCoverageStat[] = [];

  for (const criterion of Object.keys(criteria)) {
    let alDetects = 0, confirmedByAxe = 0, alUnique = 0;

    for (const r of ok) {
      const alHas = r.alWcagCriteria.includes(criterion);
      if (!alHas) continue;
      alDetects++;
      const axeHas = r.axeWcagCriteria.includes(criterion);
      if (axeHas) confirmedByAxe++;
      else alUnique++;
    }

    stats.push({ criterion, alDetects, confirmedByAxe, alUnique });
  }

  return stats.sort((a, b) => b.alDetects - a.alDetects);
}

function buildConcordanceChartData(stats: AlCoverageStat[], criteria: Record<string, string>) {
  return {
    categories: stats.map((s) => `${s.criterion} ${criteria[s.criterion] ?? ""}`),
    axeConfirms: stats.map((s) => s.confirmedByAxe),
    alUnique: stats.map((s) => s.alUnique),
  };
}

function buildKappaChartData(concordances: CriterionConcordance[]) {
  const mean = (vals: number[]) => vals.reduce((a, b) => a + b, 0) / vals.length;
  const axeAlMean = mean(concordances.map((c) => c.axeAlKappa));

  // Weighted mean kappa
  const totalWeight = concordances.reduce((s, c) => s + c.both + c.axeOnly + c.alOnly, 0);
  const weightedMean = totalWeight > 0
    ? concordances.reduce((s, c) => s + c.axeAlKappa * (c.both + c.axeOnly + c.alOnly), 0) / totalWeight
    : 0;

  return { simpleMean: +axeAlMean.toFixed(2), weightedMean: +weightedMean.toFixed(2) };
}

function renderCoverageRow(s: AlCoverageStat, concordance: CriterionConcordance | undefined, criteria: Record<string, string>): string {
  const name = criteria[s.criterion] ?? WCAG_CRITERIA_NAMES[s.criterion];
  if (!name) return "";
  const jaccard = concordance ? concordance.medianJaccard.toFixed(2) : "&mdash;";
  return `          <tr>
            <td><a href="/benches/criteria/${s.criterion}/">${s.criterion} ${escapeHtml(name)}</a></td>
            <td>${s.alDetects.toLocaleString()}</td>
            <td>${s.confirmedByAxe.toLocaleString()}</td>
            <td>${s.alUnique.toLocaleString()}</td>
            <td>${jaccard}</td>
          </tr>`;
}

function renderPage(
  ok: SiteResult[],
  alCoverage: AlCoverageStat[],
  concordances: CriterionConcordance[],
  totalSites: number,
  criteria: Record<string, string>,
): string {
  const axeMedian = Math.round(median(ok.map((r) => r.axeTimeMs)));
  const alMedian = Math.round(median(ok.map((r) => r.alTimeMs)));
  const axeSpeedup = axeMedian > 0 ? Math.round(axeMedian / alMedian) : 1;

  // Confirmation rate
  const totalAlDetects = alCoverage.reduce((s, c) => s + c.alDetects, 0);
  const totalConfirmed = alCoverage.reduce((s, c) => s + c.alDetects - c.alUnique, 0);
  const confirmationPct = totalAlDetects > 0 ? Math.round((totalConfirmed / totalAlDetects) * 100) : 0;

  const concordanceMap = new Map(concordances.map((c) => [c.criterion, c]));
  const coverageRows = alCoverage.map((s) => renderCoverageRow(s, concordanceMap.get(s.criterion), criteria)).filter(Boolean).join("\n");

  const speedData = JSON.stringify(buildSpeedChartData(ok));
  const concordanceData = JSON.stringify(buildConcordanceChartData(alCoverage, criteria));
  const kappaData = JSON.stringify(buildKappaChartData(concordances));

  const dateIso = new Date().toISOString().slice(0, 10);
  const dateHuman = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Benchmarks — a11y agent</title>
<meta name="description" content="axe-core vs @accesslint/core benchmarks tested against ${totalSites.toLocaleString()} sites from the Chrome UX Report.">
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
    <p>axe-core vs <code>@accesslint/core</code>, tested against ${totalSites.toLocaleString()} sites from the Chrome UX Report.</p>

    <h2>Speed</h2>
    <p>Median audit time across ${ok.length.toLocaleString()} successful site audits.</p>
    <div id="chart-speed"></div>

    <h2>Coverage</h2>
    <p>What <code>@accesslint/core</code> detects and how often axe-core agrees. ${confirmationPct}% of detections are confirmed by axe-core. Click a criterion to see examples.</p>
    <div class="bench-table-wrap">
      <table class="bench-table">
        <thead>
          <tr>
            <th>WCAG Criterion</th>
            <th>@accesslint/core detects</th>
            <th>axe confirms</th>
            <th>Unique</th>
            <th>Median Jaccard</th>
          </tr>
        </thead>
        <tbody>
${coverageRows}
        </tbody>
      </table>
    </div>
    <div id="chart-concordance"></div>

    <h2>Inter-rater Agreement</h2>
    <p>Mean Cohen&rsquo;s kappa (&kappa;) across all criteria. Values above 0.6 indicate substantial agreement.</p>
    <div id="chart-kappa"></div>

    <h2>Key findings</h2>
    <ul class="bench-takeaways">
      <li><code>@accesslint/core</code> is <strong>${axeSpeedup}&times; faster</strong> than axe-core at median</li>
      <li><strong>${confirmationPct}%</strong> of <code>@accesslint/core</code> detections are confirmed by axe-core</li>
      <li>Near-perfect agreement with axe-core on link-name, resize-text, and language-of-page</li>
    </ul>

    <h2>Methodology</h2>
    <ul class="bench-methodology">
      <li><strong>Sample</strong>: ${totalSites.toLocaleString()} origins from the <a href="https://developer.chrome.com/docs/crux">Chrome UX Report</a>, seeded random sample</li>
      <li><strong>Runner</strong>: Chromium via <a href="https://playwright.dev">Playwright</a>, headless, on GitHub Actions (<code>ubuntu-latest</code>)</li>
      <li><strong>axe-core</strong>: default configuration (no custom rules enabled). Only violations are compared</li>
      <li><strong><code>@accesslint/core</code></strong>: latest, default configuration</li>
      <li><strong>Execution order</strong>: randomized per page to eliminate ordering bias</li>
      <li><strong>Error handling</strong>: pages where either tool errors are excluded from kappa calculations</li>
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

const CRITERIA = selectTopCriteria(ok);
console.log(`Auto-selected ${Object.keys(CRITERIA).length} criteria by detection count`);

const concordances = calculateConcordance(results);
const alCoverage = computeAlCoverage(ok, CRITERIA);

mkdirSync(resolve(outputDir), { recursive: true });
const html = renderPage(ok, alCoverage, concordances, totalSites, CRITERIA);
writeFileSync(resolve(outputDir, "index.html"), html);
console.log(`  index.html → ${outputDir}/index.html`);
console.log("Done.");
