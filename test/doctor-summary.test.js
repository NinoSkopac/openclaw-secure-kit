const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const doctorDistPath = path.join(repoRoot, "dist", "doctor.js");
const verifierDistPath = path.join(repoRoot, "dist", "verifier.js");

function ensureDistBuilt() {
  if (fs.existsSync(doctorDistPath) && fs.existsSync(verifierDistPath)) {
    return;
  }

  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `build failed while preparing doctor summary unit test: ${result.stderr || result.stdout}`
  );
}

test("doctor summary and exit behavior use shared counts", () => {
  ensureDistBuilt();

  const { buildSecurityReportMarkdown, summarizeCheckResults } = require("../dist/verifier.js");
  const { shouldDoctorExit } = require("../dist/doctor.js");

  const mockResults = [
    { name: "check-a", status: "PASS", details: "ok" },
    { name: "check-b", status: "PASS", details: "ok" },
    { name: "check-c", status: "WARN", details: "warning" }
  ];
  const counts = summarizeCheckResults(mockResults);
  assert.deepEqual(counts, { passCount: 2, warnCount: 1, failCount: 0 });

  const report = buildSecurityReportMarkdown(
    "mock-profile",
    "/tmp/mock/docker-compose.yml",
    mockResults
  );
  const summaryMatch = report.match(/^- Summary: (\d+) PASS \/ (\d+) WARN \/ (\d+) FAIL$/m);
  assert.ok(summaryMatch, "report should include a single summary line");
  assert.deepEqual(
    [Number(summaryMatch[1]), Number(summaryMatch[2]), Number(summaryMatch[3])],
    [2, 1, 0]
  );

  assert.equal(shouldDoctorExit({ failCount: 0 }), false);
  assert.equal(shouldDoctorExit({ failCount: 1 }), true);
});
