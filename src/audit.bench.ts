import { describe, bench, beforeAll, afterAll } from "vitest";
import { JSDOM } from "jsdom";
import axe from "axe-core";
import { runAudit } from "@accesslint/core";
import { generateHtml, SMALL_SIZE, MEDIUM_SIZE, LARGE_SIZE } from "./fixtures";

// Generate HTML strings once
const smallHtml = generateHtml(SMALL_SIZE);
const mediumHtml = generateHtml(MEDIUM_SIZE);
const largeHtml = generateHtml(LARGE_SIZE);

// Create jsdom documents
const smallDoc = new JSDOM(smallHtml).window.document;
const mediumDoc = new JSDOM(mediumHtml).window.document;
const largeDoc = new JSDOM(largeHtml).window.document;

describe("audit – 100 elements", () => {
  beforeAll(() => {
    axe.setup(smallDoc);
  });
  afterAll(() => {
    axe.teardown();
  });

  bench("axe-core", async () => {
    await axe.run(smallDoc);
  });

  bench("@accesslint/core", () => {
    runAudit(smallDoc);
  });
});

describe("audit – 500 elements", () => {
  beforeAll(() => {
    axe.setup(mediumDoc);
  });
  afterAll(() => {
    axe.teardown();
  });

  bench("axe-core", async () => {
    await axe.run(mediumDoc);
  });

  bench("@accesslint/core", () => {
    runAudit(mediumDoc);
  });
});

describe("audit – 2k elements", () => {
  beforeAll(() => {
    axe.setup(largeDoc);
  });
  afterAll(() => {
    axe.teardown();
  });

  bench(
    "axe-core",
    async () => {
      await axe.run(largeDoc);
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
