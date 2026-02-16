#!/usr/bin/env tsx
/**
 * Diagnostic script for investigating concordance disagreements.
 *
 * Usage:
 *   npx tsx src/web-bench/diagnose.ts <criterion> [results-file]
 *
 * Examples:
 *   npx tsx src/web-bench/diagnose.ts 2.4.4
 *   npx tsx src/web-bench/diagnose.ts 4.1.2 results/web-bench.jsonl
 */
import { readFileSync } from "node:fs";
import type { SiteResult, CriterionPageResult } from "./types.js";

const criterion = process.argv[2];
if (!criterion) {
  console.error("Usage: npx tsx src/web-bench/diagnose.ts <criterion> [results-file]");
  process.exit(1);
}

const file = process.argv[3] ?? "results/web-bench.jsonl";
const lines = readFileSync(file, "utf-8").split("\n").filter(Boolean);
const results: SiteResult[] = lines.map((l) => JSON.parse(l));
const ok = results.filter((r) => r.status === "ok");

interface Bucket {
  label: string;
  sites: { origin: string; rank: number; detail: CriterionPageResult }[];
}

const buckets: Record<string, Bucket> = {
  allThree: { label: "All three tools found", sites: [] },
  axeOnly: { label: "axe-core only", sites: [] },
  alOnly: { label: "@accesslint/core only", sites: [] },
  ibmOnly: { label: "IBM EA only", sites: [] },
  twoOfThree: { label: "Two of three tools found", sites: [] },
};

for (const r of ok) {
  const detail = r.criteriaDetail.find((d) => d.criterion === criterion);
  const axeHas = r.axeWcagCriteria.includes(criterion);
  const alHas = r.alWcagCriteria.includes(criterion);
  const ibmHas = (r.ibmWcagCriteria ?? []).includes(criterion);

  const count = (axeHas ? 1 : 0) + (alHas ? 1 : 0) + (ibmHas ? 1 : 0);

  if (count === 3) {
    buckets.allThree.sites.push({ origin: r.origin, rank: r.rank, detail: detail! });
  } else if (count === 2) {
    buckets.twoOfThree.sites.push({ origin: r.origin, rank: r.rank, detail: detail! });
  } else if (axeHas) {
    buckets.axeOnly.sites.push({ origin: r.origin, rank: r.rank, detail: detail! });
  } else if (alHas) {
    buckets.alOnly.sites.push({ origin: r.origin, rank: r.rank, detail: detail! });
  } else if (ibmHas) {
    buckets.ibmOnly.sites.push({ origin: r.origin, rank: r.rank, detail: detail! });
  }
}

console.log(`\nDiagnostics for criterion ${criterion}`);
console.log(`Total OK sites: ${ok.length}\n`);

for (const key of ["allThree", "twoOfThree", "axeOnly", "alOnly", "ibmOnly"] as const) {
  const bucket = buckets[key];
  console.log(`--- ${bucket.label}: ${bucket.sites.length} sites ---`);

  // Show up to 20 examples
  for (const s of bucket.sites.slice(0, 20)) {
    const d = s.detail;
    const axeNodes = d?.axeNodeCount ?? "?";
    const alNodes = d?.alNodeCount ?? "?";
    const ibmNodes = d?.ibmNodeCount ?? "?";
    console.log(
      `  ${s.origin} (rank ${s.rank})` +
        `  axe:[${d?.axeRuleIds.join(",") ?? ""}] nodes=${axeNodes}` +
        `  al:[${d?.alRuleIds.join(",") ?? ""}] nodes=${alNodes}` +
        `  ibm:[${d?.ibmRuleIds.join(",") ?? ""}] nodes=${ibmNodes}`,
    );
  }

  if (bucket.sites.length > 20) {
    console.log(`  ... and ${bucket.sites.length - 20} more`);
  }
  console.log();
}
