/**
 * ACT-based fixture generator for benchmarks.
 *
 * Composes benchmark documents from W3C ACT (Accessibility Conformance Testing)
 * test cases — the same fixtures used by @accesslint/core's own test suite.
 * Includes both passing and failing cases for a realistic mix.
 */

import testcases from "./act-testcases.json";

// ── Body extraction ──────────────────────────────────────────────

const BODY_RE = /<body[^>]*>([\s\S]*?)<\/body>/i;

function extractBody(html: string): string | null {
  const m = BODY_RE.exec(html);
  if (!m) return null;
  const content = m[1].trim();
  if (!content.length) return null;
  // Neutralize iframe src to prevent network requests in browser benchmarks
  return content.replace(/<iframe([^>]*)\ssrc="[^"]*"/gi, '<iframe$1 src="about:blank"');
}

// ── Pre-extracted fragments ──────────────────────────────────────

interface Fragment {
  body: string;
  /** Rough element count (opening tags) */
  elements: number;
}

const TAG_RE = /<[a-z][^>]*>/gi;

const fragments: Fragment[] = testcases
  .map((tc) => extractBody(tc.html))
  .filter((b): b is string => b !== null)
  .map((body) => ({
    body,
    elements: (body.match(TAG_RE) || []).length,
  }))
  .filter((f) => f.elements > 0);

// ── Seeded PRNG (mulberry32) ─────────────────────────────────────

function mulberry32(seed: number): () => number {
  let s = seed | 0;
  return () => {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ── HTML generation ──────────────────────────────────────────────

const SEED = 20250206;

/**
 * Generate a benchmark HTML document targeting approximately `targetElements`
 * elements by cycling through shuffled ACT test case body fragments.
 */
export function generateHtml(targetElements: number): string {
  const rand = mulberry32(SEED);
  const shuffled = seededShuffle(fragments, rand);

  const parts: string[] = [];
  let count = 0;
  let idx = 0;

  while (count < targetElements) {
    const frag = shuffled[idx % shuffled.length];
    parts.push(frag.body);
    count += frag.elements;
    idx++;
    // Re-shuffle when we've cycled through the full pool
    if (idx > 0 && idx % shuffled.length === 0) {
      const reshuffled = seededShuffle(shuffled, rand);
      for (let i = 0; i < shuffled.length; i++) shuffled[i] = reshuffled[i];
    }
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
<title>Benchmark Document</title>
</head>
<body>
<main>
<h1>Benchmark Page</h1>
${parts.join("\n")}
</main>
</body>
</html>`;
}

/** ~100 elements */
export const SMALL_SIZE = 100;
/** ~500 elements */
export const MEDIUM_SIZE = 500;
/** ~2,000 elements */
export const LARGE_SIZE = 2_000;
