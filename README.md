# accesslint-bench

Performance benchmarks for [@accesslint/core](https://github.com/accesslint/core).

[View results notebook](https://observablehq.com/d/5906696aceb17e7a)

## Web Benchmark

Audits a sample of real websites in a Chromium browser, collecting performance timing.

```bash
npm run bench:web                               # 1,000 sites (default)
npm run bench:web -- --size=100 --seed=42       # 100 sites, reproducible
npm run bench:web -- --size=10 --timeout=15000  # quick test
```

### Options

| Flag | Default | Description |
|------|---------|-------------|
| `--size=N` | `1000` | Number of sites to sample |
| `--concurrency=N` | `5` | Parallel browser pages |
| `--timeout=N` | `30000` | Per-site timeout (ms) |
| `--output=PATH` | `results/web-bench.jsonl` | Output file |
| `--seed=N` | random | Seed for reproducible sampling |

## Methodology

### Site Selection

Sites are sampled from the [Chrome UX Report (CrUX)](https://developer.chrome.com/docs/crux) top sites list. CrUX includes origins that are publicly indexable and have sufficient real Chrome user traffic, which naturally biases toward mainstream, well-known websites.

The CrUX list is sourced from [crux-top-lists](https://github.com/zakird/crux-top-lists), a monthly snapshot of the Chrome top million websites pulled from public CrUX data in Google BigQuery.

### Content Filtering

Before sampling, the CrUX list is filtered against the [StevenBlack/hosts](https://github.com/StevenBlack/hosts) unified hosts file (adware + malware + adult content), which consolidates multiple curated blocklists covering ~155,000 domains. Domains matching the blocklist — including subdomains — are excluded.

### Auditing

For each sampled site, a Chromium browser page:

1. Navigates to the origin URL
2. Injects both [axe-core](https://www.npmjs.com/package/axe-core) and [@accesslint/core](https://www.npmjs.com/package/@accesslint/core) via script tags
3. Runs both audits, measuring wall-clock execution time for each
4. Collects violation summaries (rule IDs, WCAG criteria, element counts) and calculates concordance between the two engines

Rules run against the DOM after `DOMContentLoaded` (HTML parsed, but async resources like images may still be loading). Sites that fail to load (timeouts, connection errors, CSP blocks) are recorded as errors and excluded from aggregate statistics.

### Performance Metrics

Per-site timing is measured with `performance.now()` in the browser context. Aggregate statistics include mean, median, p95, min, and max across all successful audits.

### Output

Results are streamed to a JSONL file (one JSON object per line, per site) so data is preserved even if the process is interrupted.
