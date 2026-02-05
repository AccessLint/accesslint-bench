import { describe, bench, beforeAll } from "vitest";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { runAudit } from "@accesslint/core";
import { generateHtml, SMALL_SIZE, MEDIUM_SIZE, LARGE_SIZE } from "./fixtures";

// Generate HTML strings once
const smallHtml = generateHtml(SMALL_SIZE);
const mediumHtml = generateHtml(MEDIUM_SIZE);
const largeHtml = generateHtml(LARGE_SIZE);

// Create jsdom documents (same document used by both libraries)
const smallDoc = new JSDOM(smallHtml).window.document;
const mediumDoc = new JSDOM(mediumHtml).window.document;
const largeDoc = new JSDOM(largeHtml).window.document;

describe("audit – 100 elements", () => {
  beforeAll(async () => {
    // Warm up both libraries
    await axe.run(smallDoc);
    runAudit(smallDoc);
  });

  bench("axe-core", async () => {
    await axe.run(smallDoc);
  });

  bench("@accesslint/core", () => {
    runAudit(smallDoc);
  });
});

describe("audit – 500 elements", () => {
  beforeAll(async () => {
    await axe.run(mediumDoc);
    runAudit(mediumDoc);
  });

  bench("axe-core", async () => {
    await axe.run(mediumDoc);
  });

  bench("@accesslint/core", () => {
    runAudit(mediumDoc);
  });
});

describe("audit – 2k elements", () => {
  beforeAll(async () => {
    await axe.run(largeDoc);
    runAudit(largeDoc);
  });

  bench("axe-core", async () => {
    await axe.run(largeDoc);
  }, { time: 1000 });

  bench("@accesslint/core", () => {
    runAudit(largeDoc);
  }, { time: 1000 });
});
