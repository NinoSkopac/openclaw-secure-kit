const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const distPath = path.join(repoRoot, "dist", "install-artifacts.js");

function ensureDistBuilt() {
  if (fs.existsSync(distPath)) {
    return;
  }

  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `build failed while preparing openclaw tag test: ${result.stderr || result.stdout}`
  );
}

test("OPENCLAW_TAG validation rejects latest and empty, accepts pinned tags", () => {
  ensureDistBuilt();
  const { validateOpenclawTag } = require("../dist/install-artifacts.js");

  assert.throws(
    () => validateOpenclawTag("latest"),
    /OPENCLAW_TAG must be pinned and cannot be 'latest'\./
  );
  assert.throws(
    () => validateOpenclawTag("LATEST"),
    /OPENCLAW_TAG must be pinned and cannot be 'latest'\./
  );
  assert.throws(
    () => validateOpenclawTag(""),
    /OPENCLAW_TAG must be set to a pinned value and cannot be empty\./
  );

  assert.equal(validateOpenclawTag("2026.2.13"), "2026.2.13");
  assert.equal(validateOpenclawTag("v1.2.3"), "v1.2.3");
});
