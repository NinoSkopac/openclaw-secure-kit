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

test("systemd firewall unit template exists", () => {
  assert.equal(fs.existsSync("systemd/openclaw-secure-firewall.service"), true);
});

test("verifier module exists", () => {
  assert.equal(fs.existsSync("src/verifier.ts"), true);
});

test("install output uses docker compose --env-file before run", () => {
  const source = fs.readFileSync("src/commands.ts", "utf8");
  assert.equal(source.includes("docker compose --env-file .env run --rm"), true);
  assert.equal(source.includes("docker compose run --rm --env-file .env"), false);
});
