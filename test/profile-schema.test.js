const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = path.resolve(__dirname, "..");
const schemaDistPath = path.join(repoRoot, "dist", "profile-schema.js");

function ensureDistBuilt() {
  if (fs.existsSync(schemaDistPath)) {
    return;
  }

  const result = spawnSync("npm", ["run", "build"], {
    cwd: repoRoot,
    encoding: "utf8"
  });
  assert.equal(
    result.status,
    0,
    `build failed while preparing profile schema test: ${result.stderr || result.stdout}`
  );
}

test("profile network direct IP policy defaults and alias mapping", () => {
  ensureDistBuilt();

  const { ProfileSchema } = require("../dist/profile-schema.js");

  const defaults = ProfileSchema.parse({
    openclaw: {
      approvals: { exec: "require" }
    }
  });
  assert.equal(defaults.network.direct_ip_policy, "warn");
  assert.equal(defaults.network.egress_mode, "dns-allowlist");


  const proxyMode = ProfileSchema.parse({
    openclaw: {
      approvals: { exec: "require" }
    },
    network: {
      egress_mode: "proxy-only"
    }
  });
  assert.equal(proxyMode.network.egress_mode, "proxy-only");
  const strictAlias = ProfileSchema.parse({
    openclaw: {
      approvals: { exec: "require" }
    },
    network: {
      strict_ip_egress: true
    }
  });
  assert.equal(strictAlias.network.direct_ip_policy, "fail");
  assert.equal(strictAlias.network.egress_mode, "proxy-only");

  const legacyAddonKey = ProfileSchema.parse({
    openclaw: {
      approvals: { exec: "require" }
    },
    ["snap" + "per"]: {
      enabled: true
    }
  });
  assert.equal(Object.hasOwn(legacyAddonKey, "snap" + "per"), false);
});
