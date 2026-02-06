import { describe, bench } from "vitest";
import { Window } from "happy-dom";
import { runAudit } from "@accesslint/core";
import { generateHtml, SMALL_SIZE, MEDIUM_SIZE, LARGE_SIZE } from "./fixtures";

// Generate HTML strings once
const smallHtml = generateHtml(SMALL_SIZE);
const mediumHtml = generateHtml(MEDIUM_SIZE);
const largeHtml = generateHtml(LARGE_SIZE);

// Create happy-dom documents
function createDoc(html: string) {
  const win = new Window();
  win.document.write(html);
  return win.document;
}
const smallDoc = createDoc(smallHtml);
const mediumDoc = createDoc(mediumHtml);
const largeDoc = createDoc(largeHtml);

describe("audit – 100 elements", () => {
  bench("@accesslint/core", () => {
    runAudit(smallDoc);
  }, { time: 1000, warmupIterations: 1 });
});

describe("audit – 500 elements", () => {
  bench("@accesslint/core", () => {
    runAudit(mediumDoc);
  }, { time: 1000, warmupIterations: 1 });
});

describe("audit – 2k elements", () => {
  bench("@accesslint/core", () => {
    runAudit(largeDoc);
  }, { time: 1000, iterations: 3, warmupIterations: 1 });
});
