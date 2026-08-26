import { test } from "node:test";
import assert from "node:assert/strict";

import {
  bucketCostUSD,
  bucketDurationMs,
  bucketFileCount,
  bucketRetryCount,
  bucketTokens,
  bucketToolCalls,
} from "../src/index.js";

test("cost buckets follow published boundaries and reject garbage", () => {
  const cases = [
    [0, "zero"],
    [0.99, "under_1"],
    [1, "1_to_10"],
    [9.99, "1_to_10"],
    [10, "10_to_100"],
    [99.99, "10_to_100"],
    [100, "100_to_1000"],
    [999.99, "100_to_1000"],
    [1000, "1000_to_10000"],
    [9999.99, "1000_to_10000"],
    [10000, "over_10000"],
    [-5, "unknown"],
    [Number.NaN, "unknown"],
    [Number.POSITIVE_INFINITY, "unknown"],
    ["3", "unknown"],
    [null, "unknown"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(bucketCostUSD(input), expected, `cost ${input}`);
  }
});

test("duration buckets follow published boundaries", () => {
  const cases = [
    [0, "zero"],
    [500, "under_1s"],
    [1000, "1s_to_60s"],
    [59999, "1s_to_60s"],
    [60000, "1m_to_10m"],
    [3599999, "10m_to_60m"],
    [3600000, "1h_to_6h"],
    [21600000, "over_6h"],
    [-1, "unknown"],
    [Number.NaN, "unknown"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(bucketDurationMs(input), expected, `ms ${input}`);
  }
});

test("token buckets follow published boundaries", () => {
  const cases = [
    [0, "zero"],
    [999, "under_1k"],
    [1000, "1k_to_10k"],
    [10000, "10k_to_100k"],
    [100000, "100k_to_1m"],
    [1000000, "over_1m"],
    [1.5, "unknown"],
  ];
  for (const [input, expected] of cases) {
    assert.equal(bucketTokens(input), expected, `tokens ${input}`);
  }
});

test("tool-call, retry and file-count buckets are coarse on purpose", () => {
  assert.deepEqual(
    [0, 1, 5, 6, 21].map(bucketToolCalls),
    ["zero", "one", "2_to_5", "6_to_20", "over_20"],
  );
  assert.deepEqual(
    [0, 1, 3, 4].map(bucketRetryCount),
    ["zero", "one", "2_to_3", "over_3"],
  );
  assert.deepEqual(
    [0, 1, 3, 4, 99, 100].map(bucketFileCount),
    ["zero", "one", "2_to_3", "4_to_9", "10_to_99", "over_100"],
  );
});
