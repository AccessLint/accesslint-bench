/**
 * Real-world website benchmark using Playwright.
 * Audits sites from the CrUX top sites list with both axe-core and @accesslint/core,
 * collecting performance and concordance data.
 *
 * Usage: npm run bench:web [-- --size=1000 --concurrency=5 --timeout=30000 --seed=42]
 */
import { chromium } from "playwright";
import { downloadAndSample } from "./web-bench/sites.js";
import { auditSite } from "./web-bench/auditor.js";
import { calculateConcordance } from "./web-bench/concordance.js";
import { JsonlWriter, printSummary } from "./web-bench/reporter.js";
import type { SiteResult, BenchOptions } from "./web-bench/types.js";

function parseArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg?.split("=")[1];
}

const options: BenchOptions = {
  sampleSize: parseInt(parseArg("size") ?? "1000", 10),
  concurrency: parseInt(parseArg("concurrency") ?? "5", 10),
  timeout: parseInt(parseArg("timeout") ?? "30000", 10),
  outputFile: parseArg("output") ?? "results/web-bench.jsonl",
  seed: parseArg("seed") ? parseInt(parseArg("seed")!, 10) : undefined,
};

console.log(`\nWeb Benchmark: ${options.sampleSize} sites, concurrency=${options.concurrency}, timeout=${options.timeout}ms\n`);

// Download and sample sites
const sites = await downloadAndSample(options.sampleSize, options.seed);

// Launch browser
console.log("\nLaunching browser...");
const browser = await chromium.launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
});

// Set up output
const writer = new JsonlWriter(options.outputFile);
const allResults: SiteResult[] = [];
let completed = 0;
const startTime = Date.now();

// Concurrency pool
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      await fn(items[index]);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker()),
  );
}

// Run audits
console.log(`\nAuditing ${sites.length} sites...\n`);

await runWithConcurrency(sites, options.concurrency, async (site) => {
  const result = await auditSite(context, site.origin, site.rank, options.timeout);
  writer.write(result);
  allResults.push(result);
  completed++;

  const pct = ((completed / sites.length) * 100).toFixed(1);
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
  const status = result.status === "ok" ? "ok" : `ERR: ${result.error?.slice(0, 40)}`;
  const origin = site.origin.length > 40 ? site.origin.slice(0, 40) + "..." : site.origin;
  process.stdout.write(
    `\r  [${String(completed).padStart(String(sites.length).length)}/${sites.length}] ${pct}% ${elapsed}s  ${origin.padEnd(44)} ${status}`,
  );
});

console.log("\n");

// Clean up
await writer.close();
await browser.close();

// Calculate concordance and print summary
const concordance = calculateConcordance(allResults);
printSummary(allResults, concordance, options);
