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

function percentile(values: number[], p: number): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtMs(ms: number): string {
  return ms < 1 ? `<1 ms` : `${Math.round(ms)} ms`;
}

function buildSpeedChartData(ok: SiteResult[]) {
  const axeMedian = Math.round(median(ok.map((r) => r.axeTimeMs)));
  const alMedian = Math.round(median(ok.map((r) => r.alTimeMs)));
  const ibmMedian = Math.round(median(ok.map((r) => r.ibmTimeMs)));

  return {
    categories: ["axe-core", "@accesslint/core", "IBM EA"],
    values: [axeMedian, alMedian, ibmMedian],
    colors: ["#555555", "#0055cc", "#be95ff"],
  };
}

function buildConcordanceChartData(concordances: CriterionConcordance[]) {
  // Sort by total detected descending
  const sorted = concordances
    .filter((c) => c.criterion in CRITERIA)
    .sort((a, b) => (b.allThree + b.twoOfThree + b.oneOnly) - (a.allThree + a.twoOfThree + a.oneOnly));

  return {
    categories: sorted.map((c) => `${c.criterion} ${CRITERIA[c.criterion] ?? ""}`),
    allThree: sorted.map((c) => c.allThree),
    twoOfThree: sorted.map((c) => c.twoOfThree),
    oneOnly: sorted.map((c) => c.oneOnly),
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

function renderCoverageRow(c: CriterionConcordance): string {
  const name = CRITERIA[c.criterion];
  if (!name) return "";
  const total = c.allThree + c.twoOfThree + c.oneOnly;
  return `          <tr>
            <td><a href="/benches/criteria/${c.criterion}/">${c.criterion} ${escapeHtml(name)}</a></td>
            <td>${c.allThree.toLocaleString()}</td>
            <td>${c.twoOfThree.toLocaleString()}</td>
            <td>${c.oneOnly.toLocaleString()}</td>
            <td>${total.toLocaleString()}</td>
            <td>${c.axeAlKappa.toFixed(2)}</td>
            <td>${c.axeIbmKappa.toFixed(2)}</td>
            <td>${c.alIbmKappa.toFixed(2)}</td>
          </tr>`;
}

function renderPage(
  ok: SiteResult[],
  concordances: CriterionConcordance[],
  totalSites: number,
): string {
  const axeMedian = Math.round(median(ok.map((r) => r.axeTimeMs)));
  const alMedian = Math.round(median(ok.map((r) => r.alTimeMs)));
  const ibmMedian = Math.round(median(ok.map((r) => r.ibmTimeMs)));
  const fastest = Math.min(alMedian, axeMedian, ibmMedian);
  const slowest = Math.max(alMedian, axeMedian, ibmMedian);
  const speedupRatio = fastest > 0 ? Math.round(slowest / fastest) : 1;

  // Which tool is fastest?
  const fastestTool = alMedian <= axeMedian && alMedian <= ibmMedian ? "@accesslint/core"
    : axeMedian <= ibmMedian ? "axe-core" : "IBM EA";

  // Percentage of sites where AL is faster than both
  const alFasterCount = ok.filter((r) => r.alTimeMs < r.axeTimeMs && r.alTimeMs < r.ibmTimeMs).length;
  const alFasterPct = ((alFasterCount / ok.length) * 100).toFixed(1);

  // Sort concordances for display
  const sortedConc = concordances
    .filter((c) => c.criterion in CRITERIA)
    .sort((a, b) => (b.allThree + b.twoOfThree + b.oneOnly) - (a.allThree + a.twoOfThree + a.oneOnly));

  const coverageRows = sortedConc.map(renderCoverageRow).filter(Boolean).join("\n");

  const speedData = JSON.stringify(buildSpeedChartData(ok));
  const concordanceData = JSON.stringify(buildConcordanceChartData(concordances));
  const kappaData = JSON.stringify(buildKappaChartData(concordances));

  const dateIso = new Date().toISOString().slice(0, 10);
  const dateHuman = new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  // CSS bar widths
  const maxMs = Math.max(axeMedian, alMedian, ibmMedian);
  const axeBarPct = Math.round((axeMedian / maxMs) * 100);
  const alBarPct = Math.round((alMedian / maxMs) * 100);
  const ibmBarPct = Math.round((ibmMedian / maxMs) * 100);

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

    <dl class="bench-stats">
      <div>
        <dt>${totalSites.toLocaleString()}</dt>
        <dd>sites tested</dd>
      </div>
      <div>
        <dt>${speedupRatio}&times;</dt>
        <dd>faster at median</dd>
      </div>
      <div>
        <dt>${alFasterPct}%</dt>
        <dd>of sites faster</dd>
      </div>
      <div>
        <dt>${fmtMs(alMedian)}</dt>
        <dd>median audit time</dd>
      </div>
    </dl>

    <h2>Speed</h2>
    <p>Median audit time across ${ok.length.toLocaleString()} successful site audits.</p>
    <div class="bench-bars" role="img" aria-label="Bar chart: axe-core ${fmtMs(axeMedian)}, @accesslint/core ${fmtMs(alMedian)}, IBM EA ${fmtMs(ibmMedian)}">
      <div class="bench-bar">
        <span class="bench-bar-label">axe-core</span>
        <div class="bench-bar-track">
          <div class="bench-bar-fill bench-bar-fill--axe" style="width: ${axeBarPct}%"></div>
        </div>
        <span class="bench-bar-value">${fmtMs(axeMedian)}</span>
      </div>
      <div class="bench-bar">
        <span class="bench-bar-label"><code>@accesslint/core</code></span>
        <div class="bench-bar-track">
          <div class="bench-bar-fill bench-bar-fill--al" style="width: ${alBarPct}%"></div>
        </div>
        <span class="bench-bar-value">${fmtMs(alMedian)}</span>
      </div>
      <div class="bench-bar">
        <span class="bench-bar-label">IBM EA</span>
        <div class="bench-bar-track">
          <div class="bench-bar-fill bench-bar-fill--ibm" style="width: ${ibmBarPct}%"></div>
        </div>
        <span class="bench-bar-value">${fmtMs(ibmMedian)}</span>
      </div>
    </div>
    <div id="chart-speed"></div>

    <h2>Coverage</h2>
    <p>Per-criterion concordance across all three tools. Click a criterion to see examples.</p>
    <div class="bench-table-wrap">
      <table class="bench-table">
        <thead>
          <tr>
            <th>WCAG Criterion</th>
            <th>All three</th>
            <th>Two of three</th>
            <th>One only</th>
            <th>Any tool</th>
            <th>Axe↔AL κ</th>
            <th>Axe↔IBM κ</th>
            <th>AL↔IBM κ</th>
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
      <li><code>${escapeHtml(fastestTool)}</code> is <strong>${speedupRatio}&times; faster</strong> at median</li>
      <li>High agreement on major criteria like link-name, resize-text, and image-alt</li>
      <li>Three-tool concordance provides a stronger signal than any single tool alone</li>
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

mkdirSync(resolve(outputDir), { recursive: true });
const html = renderPage(ok, concordances, totalSites);
writeFileSync(resolve(outputDir, "index.html"), html);
console.log(`  index.html → ${outputDir}/index.html`);
console.log("Done.");
