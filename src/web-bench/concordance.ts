import type { SiteResult, CriterionConcordance } from "./types.js";

/**
 * Calculate per-criterion concordance across all successful site results.
 *
 * For each WCAG criterion, builds a 2×2 contingency table:
 *   - bothFound: both tools found violations of this criterion
 *   - axeOnly: only axe-core found violations
 *   - alOnly: only @accesslint/core found violations
 *   - neitherFound: neither tool found violations
 *
 * Computes agreement rate and Cohen's kappa for each criterion.
 */
export function calculateConcordance(results: SiteResult[]): CriterionConcordance[] {
  const okResults = results.filter((r) => r.status === "ok");
  const totalPages = okResults.length;
  if (totalPages === 0) return [];

  const allCriteria = new Set<string>();
  for (const r of okResults) {
    for (const c of r.axeWcagCriteria) allCriteria.add(c);
    for (const c of r.alWcagCriteria) allCriteria.add(c);
  }

  const concordances: CriterionConcordance[] = [];

  for (const criterion of [...allCriteria].sort()) {
    let bothFound = 0;
    let axeOnly = 0;
    let alOnly = 0;
    let neitherFound = 0;

    for (const r of okResults) {
      const axeHas = r.axeWcagCriteria.includes(criterion);
      const alHas = r.alWcagCriteria.includes(criterion);
      if (axeHas && alHas) bothFound++;
      else if (axeHas) axeOnly++;
      else if (alHas) alOnly++;
      else neitherFound++;
    }

    const agreement = (bothFound + neitherFound) / totalPages;

    // Cohen's kappa: (observed agreement - expected agreement) / (1 - expected agreement)
    const pAxe = (bothFound + axeOnly) / totalPages;
    const pAl = (bothFound + alOnly) / totalPages;
    const pe = pAxe * pAl + (1 - pAxe) * (1 - pAl);
    const kappa = pe === 1 ? 1 : (agreement - pe) / (1 - pe);

    concordances.push({
      criterion,
      bothFound,
      axeOnly,
      alOnly,
      neitherFound,
      agreement,
      cohenKappa: kappa,
    });
  }

  return concordances;
}
