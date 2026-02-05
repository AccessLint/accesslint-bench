import { createWriteStream, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { SiteResult, CriterionConcordance, BenchOptions } from "./types.js";

export class JsonlWriter {
  private stream: ReturnType<typeof createWriteStream>;

  constructor(filePath: string) {
    mkdirSync(dirname(filePath), { recursive: true });
    this.stream = createWriteStream(filePath, { flags: "w" });
  }

  write(result: SiteResult): void {
    this.stream.write(JSON.stringify(result) + "\n");
  }

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }
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

function mean(values: number[]): number {
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmtMs(ms: number): string {
  return ms < 1 ? `${(ms * 1000).toFixed(0)}µs` : `${ms.toFixed(0)}ms`;
}

export function printSummary(
  results: SiteResult[],
  concordance: CriterionConcordance[],
  options: BenchOptions,
): void {
  const ok = results.filter((r) => r.status === "ok");
  const errors = results.filter((r) => r.status === "error");

  console.log("\n" + "=".repeat(60));
  console.log(`  Web Benchmark Summary`);
  console.log("=".repeat(60));

  console.log(`\n  Sites tested:    ${results.length}`);
  console.log(`    Successful:    ${ok.length}`);
  console.log(`    Errors:        ${errors.length}`);

  if (ok.length === 0) {
    console.log("\n  No successful audits to report.");
    return;
  }

  // Performance
  const axeTimes = ok.map((r) => r.axeTimeMs);
  const alTimes = ok.map((r) => r.alTimeMs);

  console.log("\n  Performance (ms)");
  console.log(`  ${"".padEnd(18)} ${"axe-core".padStart(10)}  ${"@accesslint".padStart(12)}`);
  console.log(`  ${"Mean".padEnd(18)} ${fmtMs(mean(axeTimes)).padStart(10)}  ${fmtMs(mean(alTimes)).padStart(12)}`);
  console.log(`  ${"Median".padEnd(18)} ${fmtMs(median(axeTimes)).padStart(10)}  ${fmtMs(median(alTimes)).padStart(12)}`);
  console.log(`  ${"P95".padEnd(18)} ${fmtMs(percentile(axeTimes, 95)).padStart(10)}  ${fmtMs(percentile(alTimes, 95)).padStart(12)}`);
  console.log(`  ${"Min".padEnd(18)} ${fmtMs(Math.min(...axeTimes)).padStart(10)}  ${fmtMs(Math.min(...alTimes)).padStart(12)}`);
  console.log(`  ${"Max".padEnd(18)} ${fmtMs(Math.max(...axeTimes)).padStart(10)}  ${fmtMs(Math.max(...alTimes)).padStart(12)}`);

  // Violation counts
  const axeViolTotal = ok.reduce((s, r) => s + r.axeViolationCount, 0);
  const alViolTotal = ok.reduce((s, r) => s + r.alViolationCount, 0);
  console.log(`\n  Total violations found`);
  console.log(`    axe-core:        ${axeViolTotal.toLocaleString()}`);
  console.log(`    @accesslint:     ${alViolTotal.toLocaleString()}`);

  // Concordance
  if (concordance.length > 0) {
    console.log("\n  Concordance by WCAG Criterion");
    console.log(
      `  ${"Criterion".padEnd(12)} ${"Both".padStart(6)} ${"Axe".padStart(6)} ${"AL".padStart(6)} ${"Neither".padStart(8)} ${"Agree".padStart(7)} ${"Kappa".padStart(7)}`,
    );
    console.log(`  ${"-".repeat(53)}`);

    // Sort by most common criteria first (bothFound + axeOnly + alOnly desc)
    const sorted = concordance
      .slice()
      .sort((a, b) => (b.bothFound + b.axeOnly + b.alOnly) - (a.bothFound + a.axeOnly + a.alOnly));

    for (const c of sorted) {
      console.log(
        `  ${c.criterion.padEnd(12)} ${String(c.bothFound).padStart(6)} ${String(c.axeOnly).padStart(6)} ${String(c.alOnly).padStart(6)} ${String(c.neitherFound).padStart(8)} ${c.agreement.toFixed(2).padStart(7)} ${c.cohenKappa.toFixed(2).padStart(7)}`,
      );
    }

    const meanAgreement = mean(concordance.map((c) => c.agreement));
    const meanKappa = mean(concordance.map((c) => c.cohenKappa));
    console.log(`\n  Overall mean agreement: ${meanAgreement.toFixed(2)}`);
    console.log(`  Overall mean kappa:     ${meanKappa.toFixed(2)}`);
  }

  console.log(`\n  Results written to: ${options.outputFile}`);
  console.log("=".repeat(60) + "\n");
}
