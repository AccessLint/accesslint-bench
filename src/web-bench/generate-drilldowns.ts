#!/usr/bin/env tsx
/**
 * Generate per-criterion drilldown pages for the benchmarks site.
 *
 * Reads results/web-bench.jsonl, buckets sites per WCAG criterion,
 * selects representative examples, and writes one static HTML page
 * per criterion into the a11y-agent docs repo.
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
  let outputDir = "../a11y-agent/docs/benches/criteria";

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
      [...site.detail.axeRuleIds, ...site.detail.alRuleIds][0] ?? "unknown";
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
  tool: "axe" | "al",
): RuleFrequency[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    const ruleIds =
      tool === "axe" ? site.detail.axeRuleIds : site.detail.alRuleIds;
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
          </tr>`;
    })
    .join("\n");

  const moreNote =
    totalCount > sites.length
      ? `\n    <p>${totalCount - sites.length} more not shown.</p>`
      : "";

  return `    <h3>${escapeHtml(label)}: ${totalCount} sites</h3>
    <div class="bench-table-wrap">
      <table class="bench-table">
        <thead>
          <tr>
            <th>Site</th>
            <th>axe rules</th>
            <th>axe nodes</th>
            <th>@accesslint/core rules</th>
            <th>@accesslint/core nodes</th>
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
): string {
  if (axeRules.length === 0 && alRules.length === 0) return "";

  const maxRows = Math.max(axeRules.length, alRules.length);
  const rows: string[] = [];
  for (let i = 0; i < maxRows; i++) {
    const axe = axeRules[i];
    const al = alRules[i];
    rows.push(`          <tr>
            <td>${axe ? escapeHtml(axe.ruleId) : ""}</td>
            <td>${axe ? axe.count : ""}</td>
            <td>${al ? escapeHtml(al.ruleId) : ""}</td>
            <td>${al ? al.count : ""}</td>
          </tr>`);
  }

  return `    <h2>Rules</h2>
    <p>Which rule IDs fire for this criterion and how many sites they appear on.</p>
    <div class="bench-table-wrap">
      <table class="bench-table">
        <thead>
          <tr>
            <th>axe rule</th>
            <th>Sites</th>
            <th>@accesslint/core rule</th>
            <th>Sites</th>
          </tr>
        </thead>
        <tbody>
${rows.join("\n")}
        </tbody>
      </table>
    </div>`;
}

function renderPage(
  criterion: string,
  name: string,
  concordance: { bothFound: number; axeOnly: number; alOnly: number; agreement: number },
  axeRules: RuleFrequency[],
  alRules: RuleFrequency[],
  bothExamples: BucketSite[],
  bothTotal: number,
  axeOnlyExamples: BucketSite[],
  axeOnlyTotal: number,
  alOnlyExamples: BucketSite[],
  alOnlyTotal: number,
): string {
  const title = `WCAG ${criterion}: ${name}`;
  const agreementPct = `${Math.round(concordance.agreement * 100)}%`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)} — a11y agent</title>
<meta name="description" content="Per-criterion drilldown for ${escapeHtml(title)}: example sites from each disagreement bucket.">
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<a class="skip-link" href="#main">Skip to main content</a>

<header>
  <nav class="site-nav" aria-label="Main">
    <a class="logo" href="/">a11y agent</a>
    <ul>
      <li><a href="/benches/">Benchmarks</a></li>
      <li><a href="https://github.com/accesslint/core">GitHub</a></li>
      <li><a href="https://chromewebstore.google.com/detail/a11y-agent/dlfhldnfebkdpfiadgfbbokhkilkcldi"><span class="nav-full">Chrome Web Store</span><span class="nav-short">Install</span></a></li>
    </ul>
  </nav>
</header>

<main id="main">
  <article class="section prose">
    <h1>${escapeHtml(title)}</h1>

    <dl class="bench-stats">
      <div>
        <dt>${concordance.bothFound.toLocaleString()}</dt>
        <dd>both tools</dd>
      </div>
      <div>
        <dt>${concordance.axeOnly.toLocaleString()}</dt>
        <dd>axe-only</dd>
      </div>
      <div>
        <dt>${concordance.alOnly.toLocaleString()}</dt>
        <dd>@accesslint/core only</dd>
      </div>
      <div>
        <dt>${agreementPct}</dt>
        <dd>agreement</dd>
      </div>
    </dl>

${renderRulesTable(axeRules, alRules)}

    <h2>Examples</h2>

${renderExampleTable("Both", bothExamples, bothTotal)}

${renderExampleTable("axe-only", axeOnlyExamples, axeOnlyTotal)}

${renderExampleTable("@accesslint/core only", alOnlyExamples, alOnlyTotal)}

    <p><a href="/benches/">&larr; Back to benchmarks</a></p>
  </article>
</main>

<footer class="site-footer">
  <p>Built by <a href="https://github.com/accesslint">AccessLint</a>. MIT License.</p>
</footer>
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
  const both: BucketSite[] = [];
  const axeOnly: BucketSite[] = [];
  const alOnly: BucketSite[] = [];

  for (const r of ok) {
    const detail = r.criteriaDetail.find((d) => d.criterion === criterion);
    const axeHas = r.axeWcagCriteria.includes(criterion);
    const alHas = r.alWcagCriteria.includes(criterion);

    if (axeHas && alHas) {
      both.push({ origin: r.origin, rank: r.rank, detail: detail! });
    } else if (axeHas) {
      axeOnly.push({ origin: r.origin, rank: r.rank, detail: detail! });
    } else if (alHas) {
      alOnly.push({
        origin: r.origin,
        rank: r.rank,
        detail: detail ?? {
          criterion,
          axeFound: false,
          alFound: true,
          axeRuleIds: [],
          alRuleIds: [],
          axeNodeCount: 0,
          alNodeCount: 0,
        },
      });
    }
  }

  // Sort by rank ascending
  both.sort((a, b) => a.rank - b.rank);
  axeOnly.sort((a, b) => a.rank - b.rank);
  alOnly.sort((a, b) => a.rank - b.rank);

  // Compute rule frequencies from ALL sites (not just examples)
  const allSitesForCriterion = [...both, ...axeOnly, ...alOnly];
  const axeRules = computeRuleFrequencies(allSitesForCriterion, "axe");
  const alRules = computeRuleFrequencies(allSitesForCriterion, "al");

  // Select examples
  const bothExamples = selectExamples(both, 10);
  const axeOnlyExamples = selectExamples(axeOnly, 10);
  const alOnlyExamples = selectExamples(alOnly, 10);

  // Write HTML
  const dir = resolve(outputDir, criterion);
  mkdirSync(dir, { recursive: true });
  const html = renderPage(
    criterion,
    name,
    conc,
    axeRules,
    alRules,
    bothExamples,
    both.length,
    axeOnlyExamples,
    axeOnly.length,
    alOnlyExamples,
    alOnly.length,
  );
  writeFileSync(resolve(dir, "index.html"), html);
  console.log(`  ${criterion} ${name} → ${dir}/index.html`);
}

console.log("Done.");
