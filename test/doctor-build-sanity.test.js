const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const doctorDistPath = path.join(repoRoot, "dist", "doctor.js");

function ensureDistBuilt() {
  if (fs.existsSync(doctorDistPath)) {
    return;
  }

  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `build failed while preparing doctor build-sanity unit test: ${result.stderr || result.stdout}`
  );
}

test("findUsableOcsBuild accepts installed runtime when local dist is missing", () => {
  ensureDistBuilt();
  const { findUsableOcsBuild } = require("../dist/doctor.js");

  const cwd = "/home/ubuntu/openclaw-secure-kit";
  const invokedScript = "/opt/openclaw-secure-kit/dist/ocs.js";
  const distDir = "/opt/openclaw-secure-kit/dist";
  const existing = new Set([path.resolve(invokedScript)]);
  const exists = (target) => existing.has(path.resolve(target));

  const found = findUsableOcsBuild(cwd, invokedScript, distDir, exists);
  assert.equal(found, path.resolve(invokedScript));
});

test("findUsableOcsBuild returns null when no runtime candidate exists", () => {
  ensureDistBuilt();
  const { findUsableOcsBuild } = require("../dist/doctor.js");

  const found = findUsableOcsBuild(
    "/tmp/no-runtime-here",
    "/tmp/also-missing/ocs.js",
    "/tmp/nowhere/dist",
    () => false
  );
  assert.equal(found, null);
});
