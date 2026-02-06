# a11y-agent-bench

Performance and concordance benchmarks comparing [axe-core](https://github.com/dequelabs/axe-core) and [@accesslint/core](https://github.com/AccessLint/a11y-agent).

## Benchmarks

### ACT-Based DOM (Vitest)

Runs both tools against HTML documents composed from W3C ACT (Accessibility Conformance Testing) test cases — the same fixtures used by `@accesslint/core`'s own test suite. Documents are built at varying sizes (100, 500, 2,000 elements).

```bash
npm run bench          # Vitest benchmarks
npm run bench:browser  # Playwright benchmarks on the same ACT-based documents
```

### Real-World Websites

Audits a sample of real websites with both tools in a Chromium browser, collecting performance timing and concordance data.

```bash
npm run bench:web                               # 1,000 sites (default)
npm run bench:web -- --size=100 --seed=42       # 100 sites, reproducible
npm run bench:web -- --size=10 --timeout=15000  # quick test
```

#### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--size=N` | `1000` | Number of sites to sample |
| `--concurrency=N` | `5` | Parallel browser pages |
| `--timeout=N` | `30000` | Per-site timeout (ms) |
| `--output=PATH` | `results/web-bench.jsonl` | Output file |
| `--seed=N` | random | Seed for reproducible sampling |

## Methodology

### ACT Fixtures

The benchmark documents are composed from the [W3C ACT (Accessibility Conformance Testing)](https://www.w3.org/WAI/standards-guidelines/act/) test suite — real HTML snippets designed to exercise specific accessibility rules. The fixture pool includes both passing and failing cases across 24 rules, providing a realistic mix of correct and incorrect markup.

**Composition method:**

1. The `<body>` innerHTML is extracted from each ACT test case
2. Fragments with no body content (document-level-only rules like `document-title`, `html-has-lang`) are filtered out
3. Fragments are shuffled using a seeded PRNG (mulberry32) for reproducibility
4. Fragments are cycled until the target element count is reached
5. The result is wrapped in a page scaffold (`<html lang>`, `<head><title>`, `<main>`, `<h1>`)

This ensures the benchmark exercises real violation detection paths, not just the "no violations found" code path.

### Site Selection

Sites are sampled from the [Chrome UX Report (CrUX)](https://developer.chrome.com/docs/crux) top sites list. CrUX includes origins that are publicly indexable and have sufficient real Chrome user traffic, which naturally biases toward mainstream, well-known websites. (The [WebAIM Million](https://webaim.org/projects/million/) uses the [Tranco](https://tranco-list.eu/) list, a related but distinct ranking.)

The CrUX list is sourced from [crux-top-lists](https://github.com/zakird/crux-top-lists), a monthly snapshot of the Chrome top million websites pulled from public CrUX data in Google BigQuery.

### Content Filtering

Before sampling, the CrUX list is filtered against the [StevenBlack/hosts](https://github.com/StevenBlack/hosts) unified hosts file (adware + malware + adult content), which consolidates multiple curated blocklists covering ~155,000 domains. Domains matching the blocklist — including subdomains — are excluded.

### Auditing

For each sampled site, a Chromium browser page:

1. Navigates to the origin URL
2. Injects both [axe-core](https://www.npmjs.com/package/axe-core) and [@accesslint/core](https://www.npmjs.com/package/@accesslint/core) via script tags
3. Runs both audit tools sequentially, measuring wall-clock execution time
4. Collects violation summaries (rule IDs, WCAG criteria, element counts)

Both tools run with all rules enabled against the DOM after `DOMContentLoaded` (HTML parsed, but async resources like images may still be loading). Sites that fail to load (timeouts, connection errors, CSP blocks) are recorded as errors and excluded from aggregate statistics.

### Performance Metrics

Per-site timing is measured with `performance.now()` in the browser context. Aggregate statistics include mean, median, p95, min, and max across all successful audits.

### Concordance

Concordance measures how much the two tools agree on what accessibility violations exist. It is calculated at the **page level per WCAG success criterion**: for each criterion (e.g., 1.1.1, 4.1.2), we check whether each tool found at least one violation of that criterion on the page.

This produces a 2x2 contingency table per criterion:

|  | @accesslint found | @accesslint not found |
|--|---|---|
| **axe found** | Both | Axe only |
| **axe not found** | AL only | Neither |

From this we compute:

- **Agreement rate**: proportion of pages where both tools agree (both found + neither found)
- **Cohen's kappa**: agreement adjusted for chance, where 1.0 = perfect agreement, 0.0 = agreement no better than random

WCAG criteria are mapped from each tool's native format:
- axe-core tags rules with patterns like `wcag111` (= WCAG 1.1.1)
- @accesslint/core rules declare WCAG criteria as `["1.1.1"]`

### Output

Results are streamed to a JSONL file (one JSON object per line, per site) so data is preserved even if the process is interrupted. Each line contains the full audit result including per-criterion concordance detail.
