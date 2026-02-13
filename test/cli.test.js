const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("Phase 0 CLI scaffold exists", () => {
  assert.equal(fs.existsSync("src/ocs.ts"), true);
});

test("profile files exist", () => {
  assert.equal(fs.existsSync("profiles/research-only.yaml"), true);
  assert.equal(fs.existsSync("profiles/ops-lite.yaml"), true);
  assert.equal(fs.existsSync("profiles/dev.yaml"), true);
});
