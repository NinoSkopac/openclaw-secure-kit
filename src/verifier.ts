import { spawnSync, SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import { OPENCLAW_DNS_RESOLVER_IP, OPENCLAW_FIREWALL_UNIT_NAME } from "./constants";
import { writeInstallArtifacts } from "./install-artifacts";
import { loadProfile } from "./profile-loader";

type CheckResult = {
  name: string;
  pass: boolean;
  details: string;
};

type CommandResult = SpawnSyncReturns<string> & {
  commandLine: string;
};

type ComposeDoc = {
  services?: Record<string, unknown>;
};

function runCommand(bin: string, args: string[]): CommandResult {
  const result = spawnSync(bin, args, {
    encoding: "utf8"
  });

  return {
    ...result,
    commandLine: [bin, ...args].join(" ")
  };
}

function isPublicPortMapping(port: unknown): boolean {
  if (typeof port === "string") {
    const parts = port.split(":");
    if (parts.length === 2) {
      return true;
    }

    if (parts.length >= 3) {
      return parts[0] === "0.0.0.0";
    }

    return false;
  }

  if (typeof port === "object" && port !== null) {
    const entry = port as { host_ip?: string };
    if (entry.host_ip === undefined) {
      return true;
    }
    return entry.host_ip === "0.0.0.0";
  }

  return false;
}

function parseCompose(composePath: string): ComposeDoc {
  const source = fs.readFileSync(composePath, "utf8");
  return YAML.parse(source) as ComposeDoc;
}

function pickBlockedDomain(allowlist: string[]): string {
  const candidate = ["example.com", "iana.org", "wikipedia.org"];
  const lowerSet = new Set(allowlist.map((domain) => domain.toLowerCase()));
  return candidate.find((domain) => !lowerSet.has(domain)) ?? "example.com";
}

function trimOutput(value: string | null): string {
  return (value ?? "").trim();
}

function shortError(result: CommandResult): string {
  if (result.error) {
    return result.error.message;
  }

  const stderr = trimOutput(result.stderr);
  const stdout = trimOutput(result.stdout);
  return stderr || stdout || `exit code ${result.status ?? "unknown"}`;
}

function runCheckUiNotPublic(compose: ComposeDoc): CheckResult {
  const openclaw = (compose.services?.openclaw ?? {}) as { ports?: unknown[] };
  const ports = openclaw.ports ?? [];

  if (ports.length === 0) {
    return {
      name: "OpenClaw UI not public (no 0.0.0.0 binding)",
      pass: true,
      details: "No ports published on openclaw service."
    };
  }

  const publicPorts = ports.filter((entry) => isPublicPortMapping(entry));
  if (publicPorts.length > 0) {
    return {
      name: "OpenClaw UI not public (no 0.0.0.0 binding)",
      pass: false,
      details: `Public bindings detected: ${JSON.stringify(publicPorts)}`
    };
  }

  return {
    name: "OpenClaw UI not public (no 0.0.0.0 binding)",
    pass: true,
    details: `Published ports are localhost-only: ${JSON.stringify(ports)}`
  };
}

function runCheckContainerNonRoot(composePath: string): CheckResult {
  const result = runCommand("docker", ["compose", "-f", composePath, "exec", "-T", "openclaw", "id", "-u"]);
  if (result.status !== 0) {
    return {
      name: "Container runs as non-root",
      pass: false,
      details: shortError(result)
    };
  }

  const uid = trimOutput(result.stdout);
  return {
    name: "Container runs as non-root",
    pass: uid !== "0",
    details: `uid=${uid}`
  };
}

function runCheckNoDockerSocket(composePath: string, compose: ComposeDoc): CheckResult {
  const openclaw = (compose.services?.openclaw ?? {}) as { volumes?: unknown[] };
  const volumes = openclaw.volumes ?? [];
  const socketMounts = volumes.filter((value) => {
    if (typeof value !== "string") {
      return false;
    }
    return value.includes("/var/run/docker.sock");
  });

  if (socketMounts.length > 0) {
    return {
      name: "Docker socket not mounted",
      pass: false,
      details: `Compose mounts docker socket: ${socketMounts.join(", ")}`
    };
  }

  const result = runCommand("docker", [
    "compose",
    "-f",
    composePath,
    "exec",
    "-T",
    "openclaw",
    "sh",
    "-lc",
    "test ! -S /var/run/docker.sock"
  ]);

  if (result.status !== 0) {
    return {
      name: "Docker socket not mounted",
      pass: false,
      details: `Socket exists in container or check failed: ${shortError(result)}`
    };
  }

  return {
    name: "Docker socket not mounted",
    pass: true,
    details: "No docker socket mount detected in compose or runtime."
  };
}

function runCheckDnsForced(composePath: string, compose: ComposeDoc): CheckResult {
  const openclaw = (compose.services?.openclaw ?? {}) as { dns?: unknown[] };
  const configuredDns = (openclaw.dns ?? []).map((value) => String(value));

  if (!configuredDns.includes(OPENCLAW_DNS_RESOLVER_IP)) {
    return {
      name: "DNS forced through dns_allowlist",
      pass: false,
      details: `Compose DNS missing ${OPENCLAW_DNS_RESOLVER_IP}. Found: ${JSON.stringify(configuredDns)}`
    };
  }

  const containerId = runCommand("docker", ["compose", "-f", composePath, "ps", "-q", "openclaw"]);
  if (containerId.status !== 0) {
    return {
      name: "DNS forced through dns_allowlist",
      pass: false,
      details: shortError(containerId)
    };
  }

  const id = trimOutput(containerId.stdout);
  if (!id) {
    return {
      name: "DNS forced through dns_allowlist",
      pass: false,
      details: "openclaw container id not found."
    };
  }

  const inspect = runCommand("docker", ["inspect", id, "--format", "{{json .HostConfig.DNS}}"]);
  if (inspect.status !== 0) {
    return {
      name: "DNS forced through dns_allowlist",
      pass: false,
      details: shortError(inspect)
    };
  }

  let runtimeDns: string[] = [];
  try {
    runtimeDns = JSON.parse(trimOutput(inspect.stdout) || "[]") as string[];
  } catch {
    return {
      name: "DNS forced through dns_allowlist",
      pass: false,
      details: `Unable to parse runtime DNS config: ${trimOutput(inspect.stdout)}`
    };
  }

  const pass = runtimeDns.includes(OPENCLAW_DNS_RESOLVER_IP);
  return {
    name: "DNS forced through dns_allowlist",
    pass,
    details: `runtime dns=${JSON.stringify(runtimeDns)}`
  };
}

function runCheckEgressBlocked(composePath: string, allowlist: string[]): CheckResult {
  const blockedDomain = pickBlockedDomain(allowlist);
  const result = runCommand("docker", [
    "compose",
    "-f",
    composePath,
    "exec",
    "-T",
    "openclaw",
    "curl",
    "-I",
    "--max-time",
    "10",
    `https://${blockedDomain}`
  ]);

  if (result.status !== 0) {
    return {
      name: "Egress blocked to non-allowlisted domains",
      pass: true,
      details: `curl https://${blockedDomain} blocked as expected (${shortError(result)})`
    };
  }

  return {
    name: "Egress blocked to non-allowlisted domains",
    pass: false,
    details: `curl https://${blockedDomain} unexpectedly succeeded`
  };
}

function runCheckEgressAllowed(composePath: string, allowlist: string[]): CheckResult {
  const allowedDomain = allowlist[0];
  if (!allowedDomain) {
    return {
      name: "Egress works to allowlisted domains",
      pass: false,
      details: "No allowlisted domains in profile."
    };
  }

  const result = runCommand("docker", [
    "compose",
    "-f",
    composePath,
    "exec",
    "-T",
    "openclaw",
    "curl",
    "-I",
    "--max-time",
    "10",
    `https://${allowedDomain}`
  ]);

  return {
    name: "Egress works to allowlisted domains",
    pass: result.status === 0,
    details:
      result.status === 0
        ? `curl https://${allowedDomain} succeeded`
        : `curl https://${allowedDomain} failed (${shortError(result)})`
  };
}

function runCheckFirewallEnabled(): CheckResult {
  const enabled = runCommand("systemctl", ["is-enabled", OPENCLAW_FIREWALL_UNIT_NAME]);
  if (enabled.status !== 0) {
    return {
      name: "Firewall service enabled",
      pass: false,
      details: shortError(enabled)
    };
  }

  const state = trimOutput(enabled.stdout);
  return {
    name: "Firewall service enabled",
    pass: state === "enabled",
    details: `systemctl is-enabled returned '${state}'`
  };
}

function buildMarkdownReport(profileName: string, composePath: string, results: CheckResult[]): string {
  const passCount = results.filter((item) => item.pass).length;
  const failCount = results.length - passCount;
  const lines = [
    "# Security Report",
    "",
    `- Profile: \`${profileName}\``,
    `- Compose: \`${composePath}\``,
    `- Generated: ${new Date().toISOString()}`,
    `- Summary: ${passCount} PASS / ${failCount} FAIL`,
    "",
    "## Checks",
    ...results.map((result) => `- ${result.pass ? "PASS" : "FAIL"}: ${result.name} — ${result.details}`)
  ];

  return `${lines.join("\n")}\n`;
}

export function verifyProfile(profileName: string, outputPath: string): { passCount: number; failCount: number } {
  const profile = loadProfile(profileName);
  const outDir = writeInstallArtifacts(profileName, profile);
  const composePath = path.join(outDir, "docker-compose.yml");

  const compose = parseCompose(composePath);
  const setup = runCommand("docker", ["compose", "-f", composePath, "up", "-d"]);
  const setupOk = setup.status === 0;

  const results: CheckResult[] = [runCheckUiNotPublic(compose)];

  if (!setupOk) {
    const failureReason = `docker compose up failed: ${shortError(setup)}`;
    results.push(
      { name: "Container runs as non-root", pass: false, details: failureReason },
      { name: "Docker socket not mounted", pass: false, details: failureReason },
      { name: "DNS forced through dns_allowlist", pass: false, details: failureReason },
      { name: "Egress blocked to non-allowlisted domains", pass: false, details: failureReason },
      { name: "Egress works to allowlisted domains", pass: false, details: failureReason }
    );
  } else {
    results.push(
      runCheckContainerNonRoot(composePath),
      runCheckNoDockerSocket(composePath, compose),
      runCheckDnsForced(composePath, compose),
      runCheckEgressBlocked(composePath, profile.network.allow),
      runCheckEgressAllowed(composePath, profile.network.allow)
    );
  }

  results.push(runCheckFirewallEnabled());

  const report = buildMarkdownReport(profileName, composePath, results);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");

  const failCount = results.filter((item) => !item.pass).length;
  return {
    passCount: results.length - failCount,
    failCount
  };
}
