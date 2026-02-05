import { describe, bench } from "vitest";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { runAudit } from "@accesslint/core";
import { generateHtml, SMALL_SIZE, MEDIUM_SIZE, LARGE_SIZE } from "./fixtures";

// Generate HTML strings once
const smallHtml = generateHtml(SMALL_SIZE);
const mediumHtml = generateHtml(MEDIUM_SIZE);
const largeHtml = generateHtml(LARGE_SIZE);

// Create jsdom documents for axe-core (needs a full jsdom window)
const smallJsdom = new JSDOM(smallHtml);
const mediumJsdom = new JSDOM(mediumHtml);
const largeJsdom = new JSDOM(largeHtml);

// Create documents via DOMParser for @accesslint/core
const smallDoc = new JSDOM(smallHtml).window.document;
const mediumDoc = new JSDOM(mediumHtml).window.document;
const largeDoc = new JSDOM(largeHtml).window.document;

describe("audit – 100 elements", () => {
  bench("axe-core", async () => {
    await axe.run(smallJsdom.window.document);
  });

  bench("@accesslint/core", () => {
    runAudit(smallDoc);
  });
});

describe("audit – 500 elements", () => {
  bench("axe-core", async () => {
    await axe.run(mediumJsdom.window.document);
  });

  bench("@accesslint/core", () => {
    runAudit(mediumDoc);
  });
});

describe("audit – 2k elements", () => {
  bench(
    "axe-core",
    async () => {
      await axe.run(largeJsdom.window.document);
    },
    { time: 1000 },
  );

  bench(
    "@accesslint/core",
    () => {
      runAudit(largeDoc);
    },
    { time: 1000 },
  );
});
