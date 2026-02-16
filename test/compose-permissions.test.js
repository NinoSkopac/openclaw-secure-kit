const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const YAML = require("yaml");

const repoRoot = path.resolve(__dirname, "..");
const installArtifactsDistPath = path.join(repoRoot, "dist", "install-artifacts.js");
const profileLoaderDistPath = path.join(repoRoot, "dist", "profile-loader.js");

function ensureDistBuilt() {
  if (fs.existsSync(installArtifactsDistPath) && fs.existsSync(profileLoaderDistPath)) {
    return;
  }

  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `build failed while preparing compose permissions unit test: ${result.stderr || result.stdout}`
  );
}

test("generated compose runs openclaw-gateway as node and mounts persistent state path", () => {
  ensureDistBuilt();

  const { loadProfile } = require("../dist/profile-loader.js");
  const { writeInstallArtifacts } = require("../dist/install-artifacts.js");
  const profile = loadProfile("research-only");
  const artifacts = writeInstallArtifacts("research-only", profile, {
    autoGenerateGatewayToken: false,
    autoAdjustPorts: false
  });

  const composePath = path.join(artifacts.outDir, "docker-compose.yml");
  const compose = YAML.parse(fs.readFileSync(composePath, "utf8"));
  const gateway = compose?.services?.["openclaw-gateway"];
  assert.ok(gateway, "openclaw-gateway service should exist");
  assert.equal(gateway.user, "node:node");

  const volumes = Array.isArray(gateway.volumes) ? gateway.volumes : [];
  const hasStateMount = volumes.some((value) => String(value).includes(":/home/node/.openclaw"));
  assert.equal(hasStateMount, true, "openclaw-gateway should mount persistent state at /home/node/.openclaw");
});

test("verifier non-root logic is generic and does not hardcode uid 65532", () => {
  const verifierSource = fs.readFileSync(path.join(repoRoot, "src", "verifier.ts"), "utf8");
  assert.equal(/\b65532\b/.test(verifierSource), false);
  assert.equal(verifierSource.includes('uid !== "0"'), true);
});
