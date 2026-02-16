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

  console.log("\n" + "=".repeat(70));
  console.log(`  Web Benchmark Summary`);
  console.log("=".repeat(70));

  console.log(`\n  Sites tested:    ${results.length}`);
  console.log(`    Successful:    ${ok.length}`);
  console.log(`    Errors:        ${errors.length}`);

  if (ok.length === 0) {
    console.log("\n  No successful audits to report.");
    return;
  }

  // DOM element counts (diagnostic for SPA/empty-page detection)
  const domCounts = ok.map((r) => r.domElementCount);
  const nearEmpty = ok.filter((r) => r.domElementCount < 10);
  console.log("\n  DOM Element Counts");
  console.log(`    Median:          ${median(domCounts).toLocaleString()}`);
  console.log(`    P95:             ${percentile(domCounts, 95).toLocaleString()}`);
  console.log(`    Max:             ${Math.max(...domCounts).toLocaleString()}`);
  console.log(`    Near-empty (<10): ${nearEmpty.length}`);

  // Audit-specific errors
  const axeErrors = ok.filter((r) => r.axeStatus === "error");
  const alErrors = ok.filter((r) => r.alStatus === "error");
  const ibmErrors = ok.filter((r) => r.ibmStatus === "error");
  if (axeErrors.length > 0 || alErrors.length > 0 || ibmErrors.length > 0) {
    console.log("\n  Audit Errors (on otherwise successful pages)");
    console.log(`    axe-core errors:   ${axeErrors.length}`);
    console.log(`    @accesslint errors: ${alErrors.length}`);
    console.log(`    IBM EA errors:     ${ibmErrors.length}`);
  }

  // Performance
  const axeTimes = ok.map((r) => r.axeTimeMs);
  const alTimes = ok.map((r) => r.alTimeMs);
  const ibmTimes = ok.map((r) => r.ibmTimeMs);

  console.log("\n  Performance (ms)");
  console.log(`  ${"".padEnd(18)} ${"axe-core".padStart(10)}  ${"@accesslint".padStart(12)}  ${"IBM EA".padStart(10)}`);
  console.log(`  ${"Mean".padEnd(18)} ${fmtMs(mean(axeTimes)).padStart(10)}  ${fmtMs(mean(alTimes)).padStart(12)}  ${fmtMs(mean(ibmTimes)).padStart(10)}`);
  console.log(`  ${"Median".padEnd(18)} ${fmtMs(median(axeTimes)).padStart(10)}  ${fmtMs(median(alTimes)).padStart(12)}  ${fmtMs(median(ibmTimes)).padStart(10)}`);
  console.log(`  ${"P95".padEnd(18)} ${fmtMs(percentile(axeTimes, 95)).padStart(10)}  ${fmtMs(percentile(alTimes, 95)).padStart(12)}  ${fmtMs(percentile(ibmTimes, 95)).padStart(10)}`);
  console.log(`  ${"Min".padEnd(18)} ${fmtMs(Math.min(...axeTimes)).padStart(10)}  ${fmtMs(Math.min(...alTimes)).padStart(12)}  ${fmtMs(Math.min(...ibmTimes)).padStart(10)}`);
  console.log(`  ${"Max".padEnd(18)} ${fmtMs(Math.max(...axeTimes)).padStart(10)}  ${fmtMs(Math.max(...alTimes)).padStart(12)}  ${fmtMs(Math.max(...ibmTimes)).padStart(10)}`);

  // Violation counts
  const axeViolTotal = ok.reduce((s, r) => s + r.axeViolationCount, 0);
  const alViolTotal = ok.reduce((s, r) => s + r.alViolationCount, 0);
  const ibmViolTotal = ok.reduce((s, r) => s + r.ibmViolationCount, 0);
  console.log(`\n  Total violations found`);
  console.log(`    axe-core:        ${axeViolTotal.toLocaleString()}`);
  console.log(`    @accesslint:     ${alViolTotal.toLocaleString()}`);
  console.log(`    IBM EA:          ${ibmViolTotal.toLocaleString()}`);

  // Concordance
  if (concordance.length > 0) {
    console.log("\n  Concordance by WCAG Criterion");
    console.log(
      `  ${"Criterion".padEnd(12)} ${"All3".padStart(6)} ${"2of3".padStart(6)} ${"1only".padStart(6)} ${"None".padStart(6)} ${"Axe↔AL".padStart(8)} ${"Axe↔IBM".padStart(8)} ${"AL↔IBM".padStart(8)}`,
    );
    console.log(`  ${"-".repeat(62)}`);

    // Sort by most common criteria first (allThree + twoOfThree + oneOnly desc)
    const sorted = concordance
      .slice()
      .sort((a, b) => (b.allThree + b.twoOfThree + b.oneOnly) - (a.allThree + a.twoOfThree + a.oneOnly));

    for (const c of sorted) {
      console.log(
        `  ${c.criterion.padEnd(12)} ${String(c.allThree).padStart(6)} ${String(c.twoOfThree).padStart(6)} ${String(c.oneOnly).padStart(6)} ${String(c.noneFound).padStart(6)} ${c.axeAlKappa.toFixed(2).padStart(8)} ${c.axeIbmKappa.toFixed(2).padStart(8)} ${c.alIbmKappa.toFixed(2).padStart(8)}`,
      );
    }

    const meanAxeAl = mean(concordance.map((c) => c.axeAlKappa));
    const meanAxeIbm = mean(concordance.map((c) => c.axeIbmKappa));
    const meanAlIbm = mean(concordance.map((c) => c.alIbmKappa));
    console.log(`\n  Mean kappa:  Axe↔AL ${meanAxeAl.toFixed(2)}   Axe↔IBM ${meanAxeIbm.toFixed(2)}   AL↔IBM ${meanAlIbm.toFixed(2)}`);
  }

  console.log(`\n  Results written to: ${options.outputFile}`);
  console.log("=".repeat(70) + "\n");
}
