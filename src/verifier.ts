import { spawnSync, SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import YAML from "yaml";

import {
  OPENCLAW_DNS_RESOLVER_IP,
  OPENCLAW_FIREWALL_UNIT_NAME,
  OPENCLAW_RUNTIME_SERVICE_CANDIDATES
} from "./constants";
import { writeInstallArtifacts } from "./install-artifacts";
import { loadProfile } from "./profile-loader";

export type CheckStatus = "PASS" | "FAIL" | "WARN";

export type CheckResult = {
  name: string;
  status: CheckStatus;
  details: string;
};

export type ReportDiagnostic = {
  title: string;
  content: string;
};

type CommandResult = SpawnSyncReturns<string> & {
  commandLine: string;
};

type ComposeDoc = {
  services?: Record<string, unknown>;
};

export type VerifyProfileOptions = {
  ensureUp?: boolean;
  regenerateArtifacts?: boolean;
  directIpPolicyOverride?: "warn" | "fail";
};

export type VerifyProfileSummary = {
  passCount: number;
  warnCount: number;
  failCount: number;
  outDir: string;
  composePath: string;
  reportPath: string;
  results: CheckResult[];
  diagnostics: ReportDiagnostic[];
};

const DIRECT_IP_WARN_TEXT =
  "DNS allowlist blocks domains, but direct-to-IP HTTPS may still work. For stronger enforcement, tighten outbound 443 to an IP allowlist or force all egress through a proxy/egress gateway.";
const DIRECT_IP_HARDENING_TEXT =
  "To actually block direct-to-IP, enable hardened egress mode (proxy-only egress).";
const DEFAULT_GATEWAY_TOKEN_PLACEHOLDER = "change-me";
const GATEWAY_RUNTIME_TMPFS_CANVAS = "/home/node/.openclaw/canvas";
const GATEWAY_RUNTIME_TMPFS_CRON = "/home/node/.openclaw/cron";
const GATEWAY_RUNTIME_TMPFS_EXPECTED = [
  `${GATEWAY_RUNTIME_TMPFS_CANVAS}:rw,noexec,nosuid,size=64m,mode=1777`,
  `${GATEWAY_RUNTIME_TMPFS_CRON}:rw,noexec,nosuid,size=16m,mode=1777`
];
const GATEWAY_RUNTIME_DIR_EACCES_PATTERN =
  /(eacces:.*mkdir.*\/home\/node\/\.openclaw\/(?:canvas|cron)|permission denied.*\/home\/node\/\.openclaw\/(?:canvas|cron))/i;
const GATEWAY_DEFAULT_PORT = 18789;
const GATEWAY_MIN_PORT = 18789;
const GATEWAY_MAX_PORT = 18889;
const BRIDGE_DEFAULT_PORT = 18790;
const BRIDGE_MIN_PORT = 18790;
const BRIDGE_MAX_PORT = 18890;

function runCommand(bin: string, args: string[]): CommandResult {
  const result = spawnSync(bin, args, {
    encoding: "utf8"
  });

  return {
    ...result,
    commandLine: [bin, ...args].join(" ")
  };
}

function runCompose(composePath: string, args: string[]): CommandResult {
  const envPath = path.join(path.dirname(composePath), ".env");
  return runCommand("docker", ["compose", "-f", composePath, "--env-file", envPath, ...args]);
}

function runComposeLogs(composePath: string, service: string, tail: number): CommandResult {
  return runCompose(composePath, ["logs", "--no-color", "--tail", String(tail), service]);
}

function parseEnvFile(source: string): Record<string, string> {
  const env: Record<string, string> = {};
  const lines = source.split(/\r?\n/);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const equalsIndex = line.indexOf("=");
    if (equalsIndex <= 0) {
      continue;
    }

    const key = line.slice(0, equalsIndex).trim();
    let value = line.slice(equalsIndex + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }

  return env;
}

function parsePortValue(value: string | undefined): number | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isInteger(parsed) ? parsed : null;
}

type ParsedPortBinding = {
  hostIp: string;
  containerPort: string;
  raw: string;
};

function parsePortBinding(port: unknown): ParsedPortBinding | null {
  if (typeof port === "string") {
    const parts = port.split(":");
    if (parts.length >= 3) {
      return {
        hostIp: parts[0],
        containerPort: parts[parts.length - 1],
        raw: port
      };
    }

    if (parts.length === 2) {
      return {
        hostIp: "0.0.0.0",
        containerPort: parts[1],
        raw: port
      };
    }
  } else if (typeof port === "object" && port !== null) {
    const entry = port as { host_ip?: unknown; target?: unknown; published?: unknown };
    const target = String(entry.target ?? "");
    if (target) {
      const hostIp = entry.host_ip === undefined ? "0.0.0.0" : String(entry.host_ip);
      return {
        hostIp,
        containerPort: target,
        raw: JSON.stringify({
          host_ip: entry.host_ip,
          published: entry.published,
          target: entry.target
        })
      };
    }
  }

  return null;
}

function isPublicHostIp(hostIp: string): boolean {
  return hostIp === "" || hostIp === "0.0.0.0" || hostIp === "::";
}

function parseCompose(composePath: string): ComposeDoc {
  const source = fs.readFileSync(composePath, "utf8");
  return YAML.parse(source) as ComposeDoc;
}

function getRuntimeServiceName(compose: ComposeDoc): string | null {
  const services = compose.services ?? {};
  for (const candidate of OPENCLAW_RUNTIME_SERVICE_CANDIDATES) {
    if (services[candidate] !== undefined) {
      return candidate;
    }
  }
  return null;
}

function getOpenclawServiceNames(compose: ComposeDoc): string[] {
  const names = Object.keys(compose.services ?? {}).filter(
    (serviceName) => serviceName === "openclaw" || serviceName.startsWith("openclaw-")
  );
  return [...new Set(names)];
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

function getOpenclawContainerId(
  composePath: string,
  runtimeService: string
): { containerId: string | null; error?: string } {
  const result = runCompose(composePath, ["ps", "-q", runtimeService]);
  if (result.status !== 0) {
    return { containerId: null, error: shortError(result) };
  }

  const containerId = trimOutput(result.stdout);
  if (!containerId) {
    return { containerId: null, error: `${runtimeService} container id not found.` };
  }

  return { containerId };
}

function getContainerState(containerId: string): { status: string | null; error?: string } {
  const result = runCommand("docker", ["inspect", containerId, "--format", "{{.State.Status}}"]);
  if (result.status !== 0) {
    return { status: null, error: shortError(result) };
  }

  const status = trimOutput(result.stdout);
  if (!status) {
    return { status: null, error: "Container state is empty." };
  }

  return { status };
}

function getGatewayServiceName(compose: ComposeDoc, runtimeService: string | null): string | null {
  if ((compose.services ?? {})["openclaw-gateway"] !== undefined) {
    return "openclaw-gateway";
  }
  return runtimeService;
}

function getGatewayLogDiagnosis(
  composePath: string,
  compose: ComposeDoc,
  runtimeService: string | null
): {
  missingConfig: boolean;
  runtimeDirEacces: boolean;
  logs: string | null;
  error?: string;
  serviceName: string | null;
} {
  const serviceName = getGatewayServiceName(compose, runtimeService);
  if (!serviceName) {
    return {
      missingConfig: false,
      runtimeDirEacces: false,
      logs: null,
      error: `No runtime service found. Expected one of: ${OPENCLAW_RUNTIME_SERVICE_CANDIDATES.join(", ")}`,
      serviceName: null
    };
  }

  const logsResult = runComposeLogs(composePath, serviceName, 60);
  if (logsResult.status !== 0) {
    return {
      missingConfig: false,
      runtimeDirEacces: false,
      logs: null,
      error: shortError(logsResult),
      serviceName
    };
  }

  const logs = [trimOutput(logsResult.stdout), trimOutput(logsResult.stderr)].filter(Boolean).join("\n");
  return {
    missingConfig: /missing config/i.test(logs),
    runtimeDirEacces: GATEWAY_RUNTIME_DIR_EACCES_PATTERN.test(logs),
    logs: logs || null,
    serviceName
  };
}

function getContainerNetwork(containerId: string): { network: string | null; error?: string } {
  const result = runCommand("docker", [
    "inspect",
    containerId,
    "--format",
    "{{json .NetworkSettings.Networks}}"
  ]);
  if (result.status !== 0) {
    return { network: null, error: shortError(result) };
  }

  const raw = trimOutput(result.stdout);
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return { network: null, error: `Unable to parse network metadata: ${raw}` };
  }

  const network = Object.keys(parsed)[0] ?? null;
  if (!network) {
    return { network: null, error: "No docker network found for openclaw container." };
  }

  return { network };
}

function runCheckGatewayToken(outDir: string): CheckResult {
  const envPath = path.join(outDir, ".env");
  if (!fs.existsSync(envPath)) {
    return {
      name: "Gateway token is not default placeholder",
      status: "FAIL",
      details: `.env file not found at ${envPath}`
    };
  }

  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  const token = (env.OPENCLAW_GATEWAY_TOKEN ?? "").trim();
  if (!token) {
    return {
      name: "Gateway token is not default placeholder",
      status: "FAIL",
      details: "OPENCLAW_GATEWAY_TOKEN is missing in .env."
    };
  }

  if (token === DEFAULT_GATEWAY_TOKEN_PLACEHOLDER) {
    return {
      name: "Gateway token is not default placeholder",
      status: "FAIL",
      details: "OPENCLAW_GATEWAY_TOKEN is still set to 'change-me'."
    };
  }

  if (token.length < 32) {
    return {
      name: "Gateway token is not default placeholder",
      status: "FAIL",
      details: `OPENCLAW_GATEWAY_TOKEN is too short (${token.length} chars; expected >= 32).`
    };
  }

  return {
    name: "Gateway token is not default placeholder",
    status: "PASS",
    details: `OPENCLAW_GATEWAY_TOKEN is set (length=${token.length}).`
  };
}

function runCheckGatewayTmpfsOverlay(compose: ComposeDoc): CheckResult {
  const gatewayService = (compose.services?.["openclaw-gateway"] ?? null) as {
    tmpfs?: unknown[];
  } | null;

  if (!gatewayService) {
    return {
      name: "Gateway runtime tmpfs overlay configured",
      status: "FAIL",
      details: "openclaw-gateway service is missing from docker-compose.yml."
    };
  }

  const tmpfsEntries = (gatewayService.tmpfs ?? []).map((value) => String(value));
  const requiredPaths = [GATEWAY_RUNTIME_TMPFS_CANVAS, GATEWAY_RUNTIME_TMPFS_CRON];
  const missingPaths = requiredPaths.filter(
    (requiredPath) => !tmpfsEntries.some((entry) => entry === requiredPath || entry.startsWith(`${requiredPath}:`))
  );

  if (missingPaths.length > 0) {
    return {
      name: "Gateway runtime tmpfs overlay configured",
      status: "FAIL",
      details:
        `Missing tmpfs entries for: ${missingPaths.join(", ")}. Expected entries like: ${GATEWAY_RUNTIME_TMPFS_EXPECTED.join(" ; ")}`
    };
  }

  return {
    name: "Gateway runtime tmpfs overlay configured",
    status: "PASS",
    details: `tmpfs configured on openclaw-gateway: ${tmpfsEntries.join(", ")}`
  };
}

function runCheckGatewayTmpfsRuntime(composePath: string, runtimeService: string): CheckResult {
  const gatewayService = "openclaw-gateway";
  const containerIdResult = getOpenclawContainerId(composePath, gatewayService);
  if (!containerIdResult.containerId) {
    return {
      name: "Gateway runtime tmpfs active (HostConfig.Tmpfs)",
      status: "FAIL",
      details: containerIdResult.error ?? `${gatewayService} container id not found.`
    };
  }

  const inspect = runCommand("docker", [
    "inspect",
    containerIdResult.containerId,
    "--format",
    "{{json .HostConfig.Tmpfs}}"
  ]);
  if (inspect.status !== 0) {
    return {
      name: "Gateway runtime tmpfs active (HostConfig.Tmpfs)",
      status: "FAIL",
      details: shortError(inspect)
    };
  }

  const raw = trimOutput(inspect.stdout);
  let tmpfs: Record<string, string> = {};
  try {
    tmpfs = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
  } catch {
    return {
      name: "Gateway runtime tmpfs active (HostConfig.Tmpfs)",
      status: "FAIL",
      details: `Unable to parse HostConfig.Tmpfs: ${raw || "(empty)"}`
    };
  }

  const missingPaths = [GATEWAY_RUNTIME_TMPFS_CANVAS, GATEWAY_RUNTIME_TMPFS_CRON].filter(
    (requiredPath) => tmpfs[requiredPath] === undefined
  );
  if (missingPaths.length > 0) {
    return {
      name: "Gateway runtime tmpfs active (HostConfig.Tmpfs)",
      status: "FAIL",
      details:
        `HostConfig.Tmpfs missing required runtime paths: ${missingPaths.join(", ")}`
    };
  }

  return {
    name: "Gateway runtime tmpfs active (HostConfig.Tmpfs)",
    status: "PASS",
    details:
      `${GATEWAY_RUNTIME_TMPFS_CANVAS}, ${GATEWAY_RUNTIME_TMPFS_CRON} present in HostConfig.Tmpfs`
  };
}

function runCheckComposeUsesGatewayTokenInterpolation(outDir: string, composePath: string): CheckResult {
  if (!fs.existsSync(composePath)) {
    return {
      name: "Compose keeps gateway token externalized",
      status: "FAIL",
      details: `Compose file not found at ${composePath}`
    };
  }

  const composeSource = fs.readFileSync(composePath, "utf8");
  if (!composeSource.includes("${OPENCLAW_GATEWAY_TOKEN}")) {
    return {
      name: "Compose keeps gateway token externalized",
      status: "FAIL",
      details: "docker-compose.yml is missing ${OPENCLAW_GATEWAY_TOKEN} interpolation."
    };
  }

  const envPath = path.join(outDir, ".env");
  if (!fs.existsSync(envPath)) {
    return {
      name: "Compose keeps gateway token externalized",
      status: "FAIL",
      details: `.env file not found at ${envPath}`
    };
  }

  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  const token = (env.OPENCLAW_GATEWAY_TOKEN ?? "").trim();
  if (token && token !== DEFAULT_GATEWAY_TOKEN_PLACEHOLDER && composeSource.includes(token)) {
    return {
      name: "Compose keeps gateway token externalized",
      status: "FAIL",
      details: "docker-compose.yml contains the literal gateway token from .env."
    };
  }

  return {
    name: "Compose keeps gateway token externalized",
    status: "PASS",
    details: "docker-compose.yml uses ${OPENCLAW_GATEWAY_TOKEN} and does not contain the literal token."
  };
}

function runCheckSelectedPorts(outDir: string, composePath: string): CheckResult {
  const envPath = path.join(outDir, ".env");
  if (!fs.existsSync(envPath)) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details: `.env file not found at ${envPath}`
    };
  }

  const env = parseEnvFile(fs.readFileSync(envPath, "utf8"));
  const gatewayPort = parsePortValue(env.OPENCLAW_GATEWAY_PORT);
  const bridgePort = parsePortValue(env.OPENCLAW_BRIDGE_HOST_PORT);
  const gatewayContainerPort = parsePortValue(env.OPENCLAW_GATEWAY_CONTAINER_PORT);
  const bridgeContainerPort = parsePortValue(env.OPENCLAW_BRIDGE_CONTAINER_PORT);
  if (gatewayPort === null || bridgePort === null || gatewayContainerPort === null || bridgeContainerPort === null) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details:
        "OPENCLAW_*_PORT values in .env must be integers for host and container ports."
    };
  }

  if (gatewayPort < GATEWAY_MIN_PORT || gatewayPort > GATEWAY_MAX_PORT) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details: `OPENCLAW_GATEWAY_PORT=${gatewayPort} is outside ${GATEWAY_MIN_PORT}-${GATEWAY_MAX_PORT}.`
    };
  }

  if (bridgePort < BRIDGE_MIN_PORT || bridgePort > BRIDGE_MAX_PORT) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details: `OPENCLAW_BRIDGE_HOST_PORT=${bridgePort} is outside ${BRIDGE_MIN_PORT}-${BRIDGE_MAX_PORT}.`
    };
  }

  if (gatewayPort === bridgePort) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details: "OPENCLAW_GATEWAY_PORT and OPENCLAW_BRIDGE_HOST_PORT must be distinct."
    };
  }

  if (!fs.existsSync(composePath)) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details: `Compose file not found at ${composePath}`
    };
  }

  const composeSource = fs.readFileSync(composePath, "utf8");
  const hasInterpolation =
    composeSource.includes("${OPENCLAW_GATEWAY_PORT}") &&
    composeSource.includes("${OPENCLAW_BRIDGE_HOST_PORT}") &&
    composeSource.includes("${OPENCLAW_GATEWAY_CONTAINER_PORT}") &&
    composeSource.includes("${OPENCLAW_BRIDGE_CONTAINER_PORT}");
  if (!hasInterpolation) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "FAIL",
      details:
        "docker-compose.yml must use host and container port interpolation variables."
    };
  }

  if (gatewayPort !== GATEWAY_DEFAULT_PORT || bridgePort !== BRIDGE_DEFAULT_PORT) {
    return {
      name: "Selected ports are valid and wired via interpolation",
      status: "WARN",
      details: `Ports were auto-adjusted due to collision (gateway=${gatewayPort}, bridge=${bridgePort}).`
    };
  }

  return {
    name: "Selected ports are valid and wired via interpolation",
    status: "PASS",
    details: `Using default ports (gateway=${gatewayPort}, bridge=${bridgePort}) within allowed range.`
  };
}

function runCheckNoHardcodedComposePorts(composePath: string): CheckResult {
  if (!fs.existsSync(composePath)) {
    return {
      name: "Compose has no hardcoded gateway/bridge literals",
      status: "FAIL",
      details: `Compose file not found at ${composePath}`
    };
  }

  const composeSource = fs.readFileSync(composePath, "utf8");
  if (!composeSource.includes("http://openclaw-gateway:${OPENCLAW_GATEWAY_CONTAINER_PORT}")) {
    return {
      name: "Compose has no hardcoded gateway/bridge literals",
      status: "FAIL",
      details:
        "OPENCLAW_GATEWAY_URL must use http://openclaw-gateway:${OPENCLAW_GATEWAY_CONTAINER_PORT}."
    };
  }

  if (/\b18789\b|\b18790\b/.test(composeSource)) {
    return {
      name: "Compose has no hardcoded gateway/bridge literals",
      status: "FAIL",
      details: "docker-compose.yml contains hardcoded 18789/18790 literals."
    };
  }

  return {
    name: "Compose has no hardcoded gateway/bridge literals",
    status: "PASS",
    details: "docker-compose.yml uses interpolation for gateway/bridge ports and URL."
  };
}

function runCheckPortExposure(
  compose: ComposeDoc,
  runtimeService: string | null,
  publicListenEnabled: boolean
): CheckResult {
  if (!runtimeService) {
    return {
      name: "Gateway/bridge ports exposure matches profile",
      status: "FAIL",
      details: `No runtime service found. Expected one of: ${OPENCLAW_RUNTIME_SERVICE_CANDIDATES.join(", ")}`
    };
  }

  const runtime = (compose.services?.[runtimeService] ?? {}) as { ports?: unknown[] };
  const portBindings = (runtime.ports ?? [])
    .map((entry) => parsePortBinding(entry))
    .filter((entry): entry is ParsedPortBinding => entry !== null);
  const requiredPorts = ["${OPENCLAW_GATEWAY_CONTAINER_PORT}", "${OPENCLAW_BRIDGE_CONTAINER_PORT}"];
  const missingPorts = requiredPorts.filter(
    (requiredPort) => !portBindings.some((binding) => binding.containerPort === requiredPort)
  );

  if (missingPorts.length > 0) {
    return {
      name: "Gateway/bridge ports exposure matches profile",
      status: "FAIL",
      details: `Missing published ports on ${runtimeService}: ${missingPorts.join(", ")}`
    };
  }

  const requiredBindings = portBindings.filter((binding) => requiredPorts.includes(binding.containerPort));
  const publicBindings = requiredBindings.filter((binding) => isPublicHostIp(binding.hostIp));
  const localhostOnlyBindings = requiredBindings.filter((binding) => binding.hostIp === "127.0.0.1");

  if (!publicListenEnabled) {
    const nonLocalhostBindings = requiredBindings.filter((binding) => binding.hostIp !== "127.0.0.1");
    if (nonLocalhostBindings.length > 0) {
      return {
        name: "Gateway/bridge ports exposure matches profile",
        status: "FAIL",
        details: `public_listen=false but found non-local bindings: ${nonLocalhostBindings
          .map((binding) => binding.raw)
          .join(", ")}`
      };
    }

    return {
      name: "Gateway/bridge ports exposure matches profile",
      status: "PASS",
      details: `public_listen=false and ports are localhost-only: ${localhostOnlyBindings
        .map((binding) => binding.raw)
        .join(", ")}`
    };
  }

  if (publicBindings.length > 0) {
    return {
      name: "Gateway/bridge ports exposure matches profile",
      status: "WARN",
      details: `public_listen=true and public bindings are enabled: ${publicBindings
        .map((binding) => binding.raw)
        .join(", ")}`
    };
  }

  return {
    name: "Gateway/bridge ports exposure matches profile",
    status: "PASS",
    details: "public_listen=true but ports are not publicly bound."
  };
}

function runCheckContainerNonRoot(composePath: string, runtimeService: string): CheckResult {
  const result = runCompose(composePath, ["exec", "-T", runtimeService, "sh", "-lc", "id -u; id -g"]);
  if (result.status !== 0) {
    return {
      name: "Container runs as non-root",
      status: "FAIL",
      details: `${runtimeService}: ${shortError(result)}`
    };
  }

  const [uid = "", gid = ""] = trimOutput(result.stdout).split(/\r?\n/).map((line) => line.trim());
  if (!/^\d+$/.test(uid) || !/^\d+$/.test(gid)) {
    return {
      name: "Container runs as non-root",
      status: "FAIL",
      details: `Unable to parse runtime uid/gid from '${trimOutput(result.stdout)}'`
    };
  }

  return {
    name: "Container runs as non-root",
    status: uid !== "0" ? "PASS" : "FAIL",
    details: uid !== "0" ? `uid=${uid} gid=${gid} (non-root)` : `uid=${uid} gid=${gid} (root is not allowed)`
  };
}

function runCheckNoDockerSocket(
  composePath: string,
  compose: ComposeDoc,
  runtimeService: string,
  options: { skipRuntimeExec?: boolean; skipReason?: string } = {}
): CheckResult {
  const socketMounts: string[] = [];
  for (const serviceName of getOpenclawServiceNames(compose)) {
    const service = (compose.services?.[serviceName] ?? {}) as { volumes?: unknown[] };
    const volumes = service.volumes ?? [];
    for (const value of volumes) {
      if (typeof value === "string" && value.includes("/var/run/docker.sock")) {
        socketMounts.push(`${serviceName}: ${value}`);
      }
    }
  }

  if (socketMounts.length > 0) {
    return {
      name: "Docker socket not mounted",
      status: "FAIL",
      details: `Compose mounts docker socket: ${socketMounts.join(", ")}`
    };
  }

  if (options.skipRuntimeExec) {
    return {
      name: "Docker socket not mounted",
      status: "WARN",
      details: `SKIP: ${options.skipReason ?? "runtime check skipped"}. Compose check passed (no docker socket mount).`
    };
  }

  const result = runCompose(composePath, [
    "exec",
    "-T",
    runtimeService,
    "sh",
    "-lc",
    "test ! -S /var/run/docker.sock"
  ]);

  if (result.status !== 0) {
    return {
      name: "Docker socket not mounted",
      status: "FAIL",
      details: `Socket exists in container or check failed: ${shortError(result)}`
    };
  }

  return {
    name: "Docker socket not mounted",
    status: "PASS",
    details: "No docker socket mount detected in compose or runtime."
  };
}

function runCheckDnsForced(composePath: string, compose: ComposeDoc, runtimeService: string): CheckResult {
  const missingDnsOnServices = getOpenclawServiceNames(compose).filter((serviceName) => {
    const service = (compose.services?.[serviceName] ?? {}) as { dns?: unknown[] };
    const configuredDns = (service.dns ?? []).map((value) => String(value));
    return !configuredDns.includes(OPENCLAW_DNS_RESOLVER_IP);
  });

  if (missingDnsOnServices.length > 0) {
    return {
      name: "DNS forced through dns_allowlist",
      status: "FAIL",
      details: `Compose DNS missing ${OPENCLAW_DNS_RESOLVER_IP} on: ${missingDnsOnServices.join(", ")}`
    };
  }

  const containerIdResult = getOpenclawContainerId(composePath, runtimeService);
  if (!containerIdResult.containerId) {
    return {
      name: "DNS forced through dns_allowlist",
      status: "FAIL",
      details: containerIdResult.error ?? `${runtimeService} container id not found.`
    };
  }

  const inspect = runCommand("docker", [
    "inspect",
    containerIdResult.containerId,
    "--format",
    "{{json .HostConfig.DNS}}"
  ]);
  if (inspect.status !== 0) {
    return {
      name: "DNS forced through dns_allowlist",
      status: "FAIL",
      details: shortError(inspect)
    };
  }

  let runtimeDns: string[] = [];
  try {
    runtimeDns = JSON.parse(trimOutput(inspect.stdout) || "[]") as string[];
  } catch {
    return {
      name: "DNS forced through dns_allowlist",
      status: "FAIL",
      details: `Unable to parse runtime DNS config: ${trimOutput(inspect.stdout)}`
    };
  }

  const pass = runtimeDns.includes(OPENCLAW_DNS_RESOLVER_IP);
  return {
    name: "DNS forced through dns_allowlist",
    status: pass ? "PASS" : "FAIL",
    details: `runtime dns=${JSON.stringify(runtimeDns)}`
  };
}

function runCheckEgressBlocked(
  composePath: string,
  allowlist: string[],
  runtimeService: string
): CheckResult {
  const blockedDomain = pickBlockedDomain(allowlist);
  const result = runCompose(composePath, [
    "exec",
    "-T",
    runtimeService,
    "curl",
    "-I",
    "--max-time",
    "10",
    `https://${blockedDomain}`
  ]);

  if (result.status !== 0) {
    return {
      name: "Egress blocked to non-allowlisted domains",
      status: "PASS",
      details: `curl https://${blockedDomain} blocked as expected (${shortError(result)})`
    };
  }

  return {
    name: "Egress blocked to non-allowlisted domains",
    status: "FAIL",
    details: `curl https://${blockedDomain} unexpectedly succeeded`
  };
}

function runCheckEgressAllowed(
  composePath: string,
  allowlist: string[],
  runtimeService: string
): CheckResult {
  const allowedDomain = allowlist[0];
  if (!allowedDomain) {
    return {
      name: "Egress works to allowlisted domains",
      status: "FAIL",
      details: "No allowlisted domains in profile."
    };
  }

  const result = runCompose(composePath, [
    "exec",
    "-T",
    runtimeService,
    "curl",
    "-I",
    "--max-time",
    "10",
    `https://${allowedDomain}`
  ]);

  return {
    name: "Egress works to allowlisted domains",
    status: result.status === 0 ? "PASS" : "FAIL",
    details:
      result.status === 0
        ? `curl https://${allowedDomain} succeeded`
        : `curl https://${allowedDomain} failed (${shortError(result)})`
  };
}

function runCheckDirectToIpHttpsReachable(
  composePath: string,
  runtimeService: string,
  directIpPolicy: "warn" | "fail"
): CheckResult {
  const target = "https://1.1.1.1";
  const successStatus: CheckStatus = directIpPolicy === "fail" ? "FAIL" : "WARN";
  const guidance = `${DIRECT_IP_WARN_TEXT} ${DIRECT_IP_HARDENING_TEXT}`;

  const hasCurl = runCompose(composePath, [
    "exec",
    "-T",
    runtimeService,
    "sh",
    "-lc",
    "command -v curl >/dev/null 2>&1"
  ]);

  if (hasCurl.status === 0) {
    const directResult = runCompose(composePath, [
      "exec",
      "-T",
      runtimeService,
      "curl",
      "-k",
      "-I",
      "--max-time",
      "10",
      target
    ]);

    if (directResult.status === 0) {
      return {
        name: "Direct-to-IP HTTPS reachable",
        status: successStatus,
        details:
          `${guidance} Policy=${directIpPolicy}. Method=${runtimeService} curl to ${target} succeeded.`
      };
    }

    return {
      name: "Direct-to-IP HTTPS reachable",
      status: "PASS",
      details: `${runtimeService} curl to ${target} failed (${shortError(directResult)})`
    };
  }

  const containerIdResult = getOpenclawContainerId(composePath, runtimeService);
  if (!containerIdResult.containerId) {
    return {
      name: "Direct-to-IP HTTPS reachable",
      status: "FAIL",
      details: `Unable to determine ${runtimeService} container for fallback: ${containerIdResult.error ?? "unknown error"}`
    };
  }

  const networkResult = getContainerNetwork(containerIdResult.containerId);
  if (!networkResult.network) {
    return {
      name: "Direct-to-IP HTTPS reachable",
      status: "FAIL",
      details: `Unable to determine openclaw network for fallback: ${networkResult.error ?? "unknown error"}`
    };
  }

  const fallbackResult = runCommand("docker", [
    "run",
    "--rm",
    "--network",
    networkResult.network,
    "curlimages/curl:8.12.1",
    "-k",
    "-I",
    "--max-time",
    "10",
    target
  ]);

  if (fallbackResult.status === 0) {
    return {
      name: "Direct-to-IP HTTPS reachable",
      status: successStatus,
      details:
        `${guidance} Policy=${directIpPolicy}. Method=fallback curlimages/curl on network '${networkResult.network}' to ${target} succeeded.`
    };
  }

  return {
    name: "Direct-to-IP HTTPS reachable",
    status: "PASS",
    details: `fallback curlimages/curl to ${target} failed (${shortError(fallbackResult)})`
  };
}

function runtimeDirPermissionFailureDetails(): string {
  return [
    "gateway reported EACCES while creating /home/node/.openclaw/canvas or /home/node/.openclaw/cron.",
    "This usually means tmpfs overlays are missing for those runtime paths."
  ].join(" ");
}

function runCheckFirewallEnabled(): CheckResult {
  const enabled = runCommand("systemctl", ["is-enabled", OPENCLAW_FIREWALL_UNIT_NAME]);
  if (enabled.status !== 0) {
    return {
      name: "Firewall service enabled",
      status: "FAIL",
      details: shortError(enabled)
    };
  }

  const state = trimOutput(enabled.stdout);
  return {
    name: "Firewall service enabled",
    status: state === "enabled" ? "PASS" : "FAIL",
    details: `systemctl is-enabled returned '${state}'`
  };
}

function runSkippedRuntimeCheck(name: string, reason: string): CheckResult {
  return {
    name,
    status: "WARN",
    details: `SKIP: ${reason}`
  };
}

export function summarizeCheckResults(results: CheckResult[]): {
  passCount: number;
  warnCount: number;
  failCount: number;
} {
  const passCount = results.filter((item) => item.status === "PASS").length;
  const warnCount = results.filter((item) => item.status === "WARN").length;
  const failCount = results.filter((item) => item.status === "FAIL").length;

  return { passCount, warnCount, failCount };
}

export function buildSecurityReportMarkdown(
  profileName: string,
  composePath: string,
  results: CheckResult[],
  diagnostics: ReportDiagnostic[] = []
): string {
  const { passCount, warnCount, failCount } = summarizeCheckResults(results);
  const lines = [
    "# Security Report",
    "",
    `- Profile: \`${profileName}\``,
    `- Compose: \`${composePath}\``,
    `- Generated: ${new Date().toISOString()}`,
    `- Summary: ${passCount} PASS / ${warnCount} WARN / ${failCount} FAIL`,
    "",
    "## Checks",
    ...results.map((result) => `- ${result.status}: ${result.name} — ${result.details}`)
  ];

  if (diagnostics.length > 0) {
    lines.push("", "## Diagnostics");
    for (const diagnostic of diagnostics) {
      const safeContent = diagnostic.content.replace(/```/g, "'''");
      lines.push("", `### ${diagnostic.title}`, "```text", safeContent || "(no logs)", "```");
    }
  }

  return `${lines.join("\n")}\n`;
}

export function verifyProfile(
  profileName: string,
  outputPath: string,
  options: VerifyProfileOptions = {}
): VerifyProfileSummary {
  const profile = loadProfile(profileName);
  const directIpPolicy = options.directIpPolicyOverride ?? profile.network.direct_ip_policy;
  const outDir =
    options.regenerateArtifacts === false
      ? path.resolve(process.cwd(), "out", profileName)
      : writeInstallArtifacts(profileName, profile, {
          autoGenerateGatewayToken: false,
          autoAdjustPorts: false
        }).outDir;
  const composePath = path.join(outDir, "docker-compose.yml");
  const diagnostics: ReportDiagnostic[] = [];

  const compose = parseCompose(composePath);
  const runtimeService = getRuntimeServiceName(compose);
  const ensureUp = options.ensureUp !== false;
  const setup = ensureUp ? runCompose(composePath, ["up", "-d"]) : null;
  const setupOk = ensureUp ? (setup?.status ?? 1) === 0 : true;
  const runtimeContainer = runtimeService ? getOpenclawContainerId(composePath, runtimeService) : null;
  const runtimeState =
    runtimeContainer?.containerId
      ? getContainerState(runtimeContainer.containerId)
      : { status: null, error: runtimeContainer?.error ?? "runtime container not found" };
  const runtimeRunning = runtimeState.status === "running";

  const results: CheckResult[] = [
    runCheckGatewayToken(outDir),
    runCheckGatewayTmpfsOverlay(compose),
    runCheckComposeUsesGatewayTokenInterpolation(outDir, composePath),
    runCheckSelectedPorts(outDir, composePath),
    runCheckNoHardcodedComposePorts(composePath),
    runCheckPortExposure(compose, runtimeService, profile.openclaw.gateway.public_listen)
  ];

  const gatewayDiagnosis = getGatewayLogDiagnosis(composePath, compose, runtimeService);
  const gatewayMissingConfig = gatewayDiagnosis.missingConfig;
  const gatewayRuntimeDirEacces = gatewayDiagnosis.runtimeDirEacces;
  if (gatewayMissingConfig) {
    diagnostics.push({
      title: `${gatewayDiagnosis.serviceName ?? "openclaw-gateway"} logs (last 60 lines)`,
      content: gatewayDiagnosis.logs ?? gatewayDiagnosis.error ?? "No logs available."
    });
  }
  if (gatewayRuntimeDirEacces) {
    diagnostics.push({
      title: `${gatewayDiagnosis.serviceName ?? "openclaw-gateway"} runtime dir permission logs (last 60 lines)`,
      content: gatewayDiagnosis.logs ?? gatewayDiagnosis.error ?? "No logs available."
    });
  }

  if (gatewayRuntimeDirEacces && runtimeService) {
    const reason = runtimeDirPermissionFailureDetails();
    results.push(
      {
        name: "Gateway writable runtime dirs (canvas/cron)",
        status: "FAIL",
        details: reason
      },
      runSkippedRuntimeCheck("Container runs as non-root", reason),
      runCheckNoDockerSocket(composePath, compose, runtimeService, {
        skipRuntimeExec: true,
        skipReason: reason
      }),
      runSkippedRuntimeCheck("DNS forced through dns_allowlist", reason),
      runSkippedRuntimeCheck("Egress blocked to non-allowlisted domains", reason),
      runSkippedRuntimeCheck("Egress works to allowlisted domains", reason),
      runSkippedRuntimeCheck("Direct-to-IP HTTPS reachable", reason)
    );
  } else if (gatewayMissingConfig && runtimeService) {
    const reason = "gateway missing config (needs allow-unconfigured or gateway.mode=local)";
    results.push(
      {
        name: "Gateway startup configuration",
        status: "FAIL",
        details: reason
      },
      runSkippedRuntimeCheck("Container runs as non-root", reason),
      runCheckNoDockerSocket(composePath, compose, runtimeService, {
        skipRuntimeExec: true,
        skipReason: reason
      }),
      runSkippedRuntimeCheck("DNS forced through dns_allowlist", reason),
      runSkippedRuntimeCheck("Egress blocked to non-allowlisted domains", reason),
      runSkippedRuntimeCheck("Egress works to allowlisted domains", reason),
      runSkippedRuntimeCheck("Direct-to-IP HTTPS reachable", reason)
    );
  } else if (!setupOk || !runtimeService || !runtimeRunning) {
    const failureReason = !setupOk
      ? `docker compose up failed: ${shortError(setup as CommandResult)}`
      : !runtimeService
        ? `No runtime service found. Expected one of: ${OPENCLAW_RUNTIME_SERVICE_CANDIDATES.join(", ")}`
        : ensureUp
          ? `Runtime stack is not running (${runtimeState.error ?? runtimeState.status ?? "unknown"}).`
          : `Runtime stack is not running (${runtimeState.error ?? runtimeState.status ?? "unknown"}). Re-run without --no-up or start compose stack first.`;
    results.push(
      { name: "Container runs as non-root", status: "FAIL", details: failureReason },
      { name: "Docker socket not mounted", status: "FAIL", details: failureReason },
      { name: "DNS forced through dns_allowlist", status: "FAIL", details: failureReason },
      { name: "Egress blocked to non-allowlisted domains", status: "FAIL", details: failureReason },
      { name: "Egress works to allowlisted domains", status: "FAIL", details: failureReason },
      { name: "Direct-to-IP HTTPS reachable", status: "FAIL", details: failureReason }
    );
  } else {
    results.push(
      runCheckGatewayTmpfsRuntime(composePath, runtimeService as string),
      runCheckContainerNonRoot(composePath, runtimeService as string),
      runCheckNoDockerSocket(composePath, compose, runtimeService as string),
      runCheckDnsForced(composePath, compose, runtimeService as string),
      runCheckEgressBlocked(composePath, profile.network.allow, runtimeService as string),
      runCheckEgressAllowed(composePath, profile.network.allow, runtimeService as string),
      runCheckDirectToIpHttpsReachable(composePath, runtimeService as string, directIpPolicy)
    );
  }

  results.push(runCheckFirewallEnabled());

  const report = buildSecurityReportMarkdown(profileName, composePath, results, diagnostics);
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, report, "utf8");

  const { passCount, warnCount, failCount } = summarizeCheckResults(results);
  return {
    passCount,
    warnCount,
    failCount,
    outDir,
    composePath,
    reportPath: outputPath,
    results: [...results],
    diagnostics: [...diagnostics]
  };
}
