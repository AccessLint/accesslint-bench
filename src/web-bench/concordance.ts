import type { SiteResult, CriterionConcordance } from "./types.js";

/**
 * Compute Cohen's kappa from a 2×2 contingency table.
 */
function cohenKappa(a: number, b: number, c: number, d: number): number {
  const n = a + b + c + d;
  if (n === 0) return 1;
  const po = (a + d) / n;
  const p1 = (a + b) / n;
  const p2 = (a + c) / n;
  const pe = p1 * p2 + (1 - p1) * (1 - p2);
  return pe === 1 ? 1 : (po - pe) / (1 - pe);
}

/**
 * Calculate per-criterion 3-way concordance across all successful site results.
 *
 * For each WCAG criterion, counts how many of the three tools (axe, AL, IBM)
 * found violations on each page, then computes pairwise Cohen's kappa.
 */
export function calculateConcordance(results: SiteResult[]): CriterionConcordance[] {
  const okResults = results.filter((r) => r.status === "ok");
  const totalPages = okResults.length;
  if (totalPages === 0) return [];

  const allCriteria = new Set<string>();
  for (const r of okResults) {
    for (const c of r.axeWcagCriteria) allCriteria.add(c);
    for (const c of r.alWcagCriteria) allCriteria.add(c);
    for (const c of r.ibmWcagCriteria ?? []) allCriteria.add(c);
  }

  const concordances: CriterionConcordance[] = [];

  for (const criterion of [...allCriteria].sort()) {
    let allThree = 0;
    let twoOfThree = 0;
    let oneOnly = 0;
    let noneFound = 0;

    // Pairwise 2×2 tables: [bothYes, tool1Only, tool2Only, neitherYes]
    let axeAlBoth = 0, axeAlAxeOnly = 0, axeAlAlOnly = 0, axeAlNeither = 0;
    let axeIbmBoth = 0, axeIbmAxeOnly = 0, axeIbmIbmOnly = 0, axeIbmNeither = 0;
    let alIbmBoth = 0, alIbmAlOnly = 0, alIbmIbmOnly = 0, alIbmNeither = 0;

    for (const r of okResults) {
      const axeHas = r.axeWcagCriteria.includes(criterion);
      const alHas = r.alWcagCriteria.includes(criterion);
      const ibmHas = (r.ibmWcagCriteria ?? []).includes(criterion);

      const count = (axeHas ? 1 : 0) + (alHas ? 1 : 0) + (ibmHas ? 1 : 0);
      if (count === 3) allThree++;
      else if (count === 2) twoOfThree++;
      else if (count === 1) oneOnly++;
      else noneFound++;

      // axe ↔ AL
      if (axeHas && alHas) axeAlBoth++;
      else if (axeHas) axeAlAxeOnly++;
      else if (alHas) axeAlAlOnly++;
      else axeAlNeither++;

      // axe ↔ IBM
      if (axeHas && ibmHas) axeIbmBoth++;
      else if (axeHas) axeIbmAxeOnly++;
      else if (ibmHas) axeIbmIbmOnly++;
      else axeIbmNeither++;

      // AL ↔ IBM
      if (alHas && ibmHas) alIbmBoth++;
      else if (alHas) alIbmAlOnly++;
      else if (ibmHas) alIbmIbmOnly++;
      else alIbmNeither++;
    }

    concordances.push({
      criterion,
      allThree,
      twoOfThree,
      oneOnly,
      noneFound,
      axeAlKappa: cohenKappa(axeAlBoth, axeAlAxeOnly, axeAlAlOnly, axeAlNeither),
      axeIbmKappa: cohenKappa(axeIbmBoth, axeIbmAxeOnly, axeIbmIbmOnly, axeIbmNeither),
      alIbmKappa: cohenKappa(alIbmBoth, alIbmAlOnly, alIbmIbmOnly, alIbmNeither),
    });
  }

  return concordances;
}
