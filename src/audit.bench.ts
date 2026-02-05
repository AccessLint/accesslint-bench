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
    axe.setup(smallDoc);
    await axe.run(smallDoc);
    axe.teardown();
    runAudit(smallDoc);
  });

  bench("axe-core", async () => {
    axe.setup(smallDoc);
    await axe.run(smallDoc);
    axe.teardown();
  });

  bench("@accesslint/core", () => {
    runAudit(smallDoc);
  });
});

describe("audit – 500 elements", () => {
  beforeAll(async () => {
    axe.setup(mediumDoc);
    await axe.run(mediumDoc);
    axe.teardown();
    runAudit(mediumDoc);
  });

  bench("axe-core", async () => {
    axe.setup(mediumDoc);
    await axe.run(mediumDoc);
    axe.teardown();
  });

  bench("@accesslint/core", () => {
    runAudit(mediumDoc);
  });
});

describe("audit – 2k elements", () => {
  beforeAll(async () => {
    axe.setup(largeDoc);
    await axe.run(largeDoc);
    axe.teardown();
    runAudit(largeDoc);
  });

  bench("axe-core", async () => {
    axe.setup(largeDoc);
    await axe.run(largeDoc);
    axe.teardown();
  }, { time: 1000 });

  bench("@accesslint/core", () => {
    runAudit(largeDoc);
  }, { time: 1000 });
});
