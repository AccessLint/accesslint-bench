/**
 * Convert axe-core WCAG tags to dot-notation WCAG criteria.
 *
 * axe tags rules with patterns like "wcag111" (= 1.1.1) and "wcag1412" (= 1.4.12).
 * The format is: wcag + principle(1 digit) + guideline(1 digit) + criterion(1+ digits).
 * Level tags like "wcag2a" and "wcag21aa" are filtered out by the regex.
 */
export function axeTagToWcagCriterion(tag: string): string | null {
  const match = tag.match(/^wcag(\d)(\d)(\d+)$/);
  if (!match) return null;
  return `${match[1]}.${match[2]}.${match[3]}`;
}

/** Extract all WCAG criteria from an axe violation's tags array. */
export function extractAxeWcagCriteria(tags: string[]): string[] {
  return tags
    .map(axeTagToWcagCriterion)
    .filter((c): c is string => c !== null);
}
