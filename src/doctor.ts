import { spawnSync, SpawnSyncReturns } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { writeInstallArtifacts } from "./install-artifacts";
import { loadProfile } from "./profile-loader";
import {
  buildSecurityReportMarkdown,
  CheckResult,
  ReportDiagnostic,
  summarizeCheckResults,
  verifyProfile
} from "./verifier";

type CommandResult = SpawnSyncReturns<string> & {
  commandLine: string;
};

export type DoctorOptions = {
  noUp?: boolean;
  directIpPolicyOverride?: "warn" | "fail";
  verbose?: boolean;
};

export type DoctorSummary = {
  passCount: number;
  warnCount: number;
  failCount: number;
  reportPath: string;
  reportWritten: boolean;
  securityReportPath: string;
  securityReportWritten: boolean;
  version: string;
  commit: string;
  requiresSudo: boolean;
  verboseInfo: string[];
};

export function shouldDoctorExit(summary: Pick<DoctorSummary, "failCount">): boolean {
  return summary.failCount > 0;
}

const GATEWAY_RUNTIME_DIR_EACCES_PATTERN =
  /(eacces:.*mkdir.*\/home\/node\/\.openclaw\/(?:canvas|cron)|permission denied.*\/home\/node\/\.openclaw\/(?:canvas|cron))/i;

function runCommand(bin: string, args: string[]): CommandResult {
  const result = spawnSync(bin, args, {
    encoding: "utf8"
  });

  return {
    ...result,
    commandLine: [bin, ...args].join(" ")
  };
}

function runCompose(composePath: string, envPath: string, args: string[]): CommandResult {
  return runCommand("docker", ["compose", "-f", composePath, "--env-file", envPath, ...args]);
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

export function findUsableOcsBuild(
  cwd: string = process.cwd(),
  invokedScript: string | undefined = process.argv[1],
  distDir: string = __dirname,
  exists: (target: string) => boolean = fs.existsSync
): string | null {
  const candidates: string[] = [];
  const addCandidate = (candidate: string | undefined): void => {
    if (!candidate) {
      return;
    }
    const resolved = path.resolve(candidate);
    if (!candidates.includes(resolved)) {
      candidates.push(resolved);
    }
  };

  addCandidate(path.join(cwd, "dist", "ocs.js"));
  addCandidate(invokedScript);
  addCandidate(path.join(distDir, "ocs.js"));

  for (const candidate of candidates) {
    if (exists(candidate)) {
      return candidate;
    }
  }

  return null;
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

function indicatesPermissionIssue(message: string): boolean {
  return /eperm|eacces|permission denied|operation not permitted/i.test(message);
}

function runGatewayTmpfsComposeCheck(composeSource: string): CheckResult {
  const hasCanvasTmpfs = composeSource.includes("/home/node/.openclaw/canvas");
  const hasCronTmpfs = composeSource.includes("/home/node/.openclaw/cron");
  if (!hasCanvasTmpfs || !hasCronTmpfs) {
    return {
      status: "FAIL",
      name: "Gateway runtime tmpfs overlay configured",
      details:
        "docker-compose.yml must include tmpfs overlays for /home/node/.openclaw/canvas and /home/node/.openclaw/cron."
    };
  }

  return {
    status: "PASS",
    name: "Gateway runtime tmpfs overlay configured",
    details: "Compose includes tmpfs overlays for canvas/cron runtime directories."
  };
}

function runGatewayRuntimeDirLogCheck(composePath: string, envPath: string): CheckResult {
  const logsResult = runCompose(composePath, envPath, ["logs", "--no-color", "--tail", "120", "openclaw-gateway"]);
  if (logsResult.status !== 0) {
    return {
      status: "WARN",
      name: "Gateway writable runtime dirs (canvas/cron)",
      details: `SKIP: unable to read openclaw-gateway logs (${shortError(logsResult)}).`
    };
  }

  const logs = [trimOutput(logsResult.stdout), trimOutput(logsResult.stderr)].filter(Boolean).join("\n");
  if (GATEWAY_RUNTIME_DIR_EACCES_PATTERN.test(logs)) {
    return {
      status: "FAIL",
      name: "Gateway writable runtime dirs (canvas/cron)",
      details:
        "gateway reported EACCES while creating /home/node/.openclaw/canvas or /home/node/.openclaw/cron. This usually means the tmpfs overlay is missing."
    };
  }

  return {
    status: "PASS",
    name: "Gateway writable runtime dirs (canvas/cron)",
    details: "No EACCES mkdir errors for canvas/cron found in recent gateway logs."
  };
}

type TmpfsInspection = {
  status: "INFO" | "WARN";
  message: string;
};

function inspectGatewayTmpfs(composePath: string, envPath: string): TmpfsInspection {
  const containerIdResult = runCompose(composePath, envPath, ["ps", "-q", "openclaw-gateway"]);
  if (containerIdResult.status !== 0) {
    return {
      status: "WARN",
      message: `tmpfs inspect skipped: unable to get openclaw-gateway container id (${shortError(containerIdResult)})`
    };
  }

  const containerId = trimOutput(containerIdResult.stdout);
  if (!containerId) {
    return {
      status: "WARN",
      message: "tmpfs inspect skipped: openclaw-gateway container is not running."
    };
  }

  const inspectResult = runCommand("docker", [
    "inspect",
    containerId,
    "--format",
    "{{json .HostConfig.Tmpfs}}"
  ]);
  if (inspectResult.status !== 0) {
    return {
      status: "WARN",
      message: `tmpfs inspect skipped: unable to read HostConfig.Tmpfs (${shortError(inspectResult)})`
    };
  }

  const raw = trimOutput(inspectResult.stdout);
  let parsed: Record<string, string>;
  try {
    parsed = (raw ? JSON.parse(raw) : {}) as Record<string, string>;
  } catch {
    return {
      status: "WARN",
      message: `tmpfs inspect skipped: invalid HostConfig.Tmpfs payload (${raw || "empty"})`
    };
  }

  const tmpfsPaths = Object.keys(parsed).sort();
  const requiredPaths = ["/home/node/.openclaw/canvas", "/home/node/.openclaw/cron"];
  const hasAllRequired = requiredPaths.every((requiredPath) => tmpfsPaths.includes(requiredPath));
  if (hasAllRequired) {
    return {
      status: "INFO",
      message:
        "tmpfs configured: /home/node/.openclaw/canvas, /home/node/.openclaw/cron (Docker stores tmpfs under HostConfig.Tmpfs; not visible in .Mounts)"
    };
  }

  return {
    status: "WARN",
    message: `tmpfs inspection found incomplete runtime paths in HostConfig.Tmpfs: ${tmpfsPaths.join(", ") || "(none)"}`
  };
}

function buildDoctorReportMarkdown(
  profileName: string,
  composePath: string,
  securityReportPath: string,
  results: CheckResult[],
  diagnostics: ReportDiagnostic[] = []
): string {
  const { passCount, warnCount, failCount } = summarizeCheckResults(results);
  const lines = [
    "# Doctor Report",
    "",
    `- Profile: \`${profileName}\``,
    `- Compose: \`${composePath}\``,
    `- Security report: \`${securityReportPath}\``,
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

function resolveVersion(): { version: string; commit: string } {
  let version = "unknown";
  try {
    const packageJsonPath = path.resolve(process.cwd(), "package.json");
    if (fs.existsSync(packageJsonPath)) {
      const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
      version = packageJson.version ?? "unknown";
    }
  } catch {
    version = "unknown";
  }

  const commitResult = runCommand("git", ["rev-parse", "--short", "HEAD"]);
  const commit = commitResult.status === 0 ? trimOutput(commitResult.stdout) || "unknown" : "unknown";
  return { version, commit };
}

export function doctorProfile(profileName: string, options: DoctorOptions = {}): DoctorSummary {
  let requiresSudo = false;
  let doctorReportWriteSucceeded = false;
  let securityReportWriteSucceeded = false;
  const doctorResults: CheckResult[] = [];
  const doctorDiagnostics: ReportDiagnostic[] = [];
  const verboseInfo: string[] = [];

  const addDoctorResult = (status: CheckResult["status"], name: string, details: string): void => {
    doctorResults.push({ status, name, details });
  };

  const { version, commit } = resolveVersion();
  let outDir = path.resolve(process.cwd(), "out", profileName);
  let composePath = path.join(outDir, "docker-compose.yml");
  let envPath = path.join(outDir, ".env");
  let securityReportPath = path.join(outDir, "security-report.md");
  let doctorReportPath = path.join(outDir, "doctor-report.md");

  const usableBuildPath = findUsableOcsBuild();
  if (usableBuildPath !== null) {
    addDoctorResult("PASS", "Build sanity", `ocs runtime found at ${usableBuildPath}.`);
  } else {
    addDoctorResult(
      "FAIL",
      "Build sanity",
      "No usable ocs runtime found (local dist missing and installed runtime unavailable). Run `npm run build` or `sudo ./install.sh`."
    );
  }

  let profileLoaded = false;
  let loadedProfile: ReturnType<typeof loadProfile> | null = null;
  try {
    loadedProfile = loadProfile(profileName);
    profileLoaded = true;
    addDoctorResult("PASS", "Profile loading", `Profile '${profileName}' loaded and validated.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDoctorResult("FAIL", "Profile loading", message);
  }

  if (profileLoaded && loadedProfile !== null) {
    try {
      const artifacts = writeInstallArtifacts(profileName, loadedProfile, {
        autoGenerateGatewayToken: true,
        autoAdjustPorts: true
      });
      outDir = artifacts.outDir;
      composePath = path.join(outDir, "docker-compose.yml");
      envPath = path.join(outDir, ".env");
      securityReportPath = path.join(outDir, "security-report.md");
      doctorReportPath = path.join(outDir, "doctor-report.md");
      addDoctorResult("PASS", "Artifact generation sanity", `Generated artifacts under ${outDir}.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      addDoctorResult("FAIL", "Artifact generation sanity", message);
      requiresSudo = requiresSudo || indicatesPermissionIssue(message);
    }
  } else {
    addDoctorResult("FAIL", "Artifact generation sanity", "Skipped because profile failed to load.");
  }

  const requiredFiles: Array<{ label: string; target: string }> = [
    { label: "out directory exists", target: outDir },
    { label: ".env exists", target: envPath },
    { label: "docker-compose.yml exists", target: composePath }
  ];
  for (const required of requiredFiles) {
    if (fs.existsSync(required.target)) {
      addDoctorResult("PASS", "Artifact generation sanity", `${required.label}: ${required.target}`);
    } else {
      addDoctorResult("FAIL", "Artifact generation sanity", `${required.label}: missing at ${required.target}`);
    }
  }

  const composeSource = fs.existsSync(composePath) ? fs.readFileSync(composePath, "utf8") : "";
  const envSource = fs.existsSync(envPath) ? fs.readFileSync(envPath, "utf8") : "";
  const env = parseEnvFile(envSource);
  const gatewayToken = (env.OPENCLAW_GATEWAY_TOKEN ?? "").trim();
  const hasInterpolation = composeSource.includes("${OPENCLAW_GATEWAY_TOKEN}");
  const leaksToken = Boolean(gatewayToken) && composeSource.includes(gatewayToken);
  if (hasInterpolation && !leaksToken) {
    addDoctorResult(
      "PASS",
      "Secrets externalization",
      "docker-compose.yml references ${OPENCLAW_GATEWAY_TOKEN} and does not embed the literal token."
    );
  } else {
    addDoctorResult(
      "FAIL",
      "Secrets externalization",
      "docker-compose.yml must use ${OPENCLAW_GATEWAY_TOKEN} and avoid embedding literal token values."
    );
  }

  const composeConfig = runCompose(composePath, envPath, ["config"]);
  if (composeConfig.status === 0) {
    addDoctorResult("PASS", "Compose validation", "docker compose config succeeded.");
  } else {
    const message = shortError(composeConfig);
    addDoctorResult("FAIL", "Compose validation", `docker compose config failed: ${message}`);
    requiresSudo = requiresSudo || indicatesPermissionIssue(message);
  }
  const tmpfsCheck = runGatewayTmpfsComposeCheck(composeSource);
  addDoctorResult(tmpfsCheck.status, tmpfsCheck.name, tmpfsCheck.details);

  if (composeConfig.status === 0) {
    const runtimeDirLogCheck = runGatewayRuntimeDirLogCheck(composePath, envPath);
    addDoctorResult(runtimeDirLogCheck.status, runtimeDirLogCheck.name, runtimeDirLogCheck.details);
    if (options.verbose === true) {
      const tmpfsInspection = inspectGatewayTmpfs(composePath, envPath);
      const prefixedMessage = `${tmpfsInspection.status}: ${tmpfsInspection.message}`;
      verboseInfo.push(prefixedMessage);
      doctorDiagnostics.push({
        title: "Runtime tmpfs inspection",
        content: prefixedMessage
      });
    }
  }

  const canRunVerify = doctorResults.every((result) => result.status !== "FAIL");
  try {
    if (canRunVerify) {
      const verifySummary = verifyProfile(profileName, securityReportPath, {
        ensureUp: options.noUp !== true,
        regenerateArtifacts: false,
        directIpPolicyOverride: options.directIpPolicyOverride
      });
      securityReportWriteSucceeded = true;
      if (verifySummary.failCount > 0) {
        addDoctorResult(
          "FAIL",
          "Security verification",
          `security-report.md contains failures (${verifySummary.passCount} PASS / ${verifySummary.warnCount} WARN / ${verifySummary.failCount} FAIL).`
        );
      } else if (verifySummary.warnCount > 0) {
        addDoctorResult(
          "WARN",
          "Security verification",
          `security-report.md contains warnings (${verifySummary.passCount} PASS / ${verifySummary.warnCount} WARN / ${verifySummary.failCount} FAIL).`
        );
      } else {
        addDoctorResult(
          "PASS",
          "Security verification",
          `security-report.md contains only PASS checks (${verifySummary.passCount} PASS).`
        );
      }
      if (verifySummary.diagnostics.length > 0) {
        doctorDiagnostics.push(...verifySummary.diagnostics);
      }
    } else {
      const hasTmpfsPermissionFailure = doctorResults.some(
        (result) =>
          result.status === "FAIL" && result.name === "Gateway writable runtime dirs (canvas/cron)"
      );
      const skippedStatus: CheckResult["status"] = hasTmpfsPermissionFailure ? "WARN" : "FAIL";
      const skippedDetails = "Skipped because one or more doctor preflight checks failed.";
      addDoctorResult(
        skippedStatus,
        "Security verification",
        `security-report.md not executed. ${skippedDetails}`
      );

      const skippedSecurityResults: CheckResult[] = [
        {
          status: skippedStatus,
          name: "Security verification",
          details: skippedDetails
        }
      ];
      const skippedReport = buildSecurityReportMarkdown(
        profileName,
        composePath,
        skippedSecurityResults
      );
      fs.mkdirSync(path.dirname(securityReportPath), { recursive: true });
      fs.writeFileSync(securityReportPath, skippedReport, "utf8");
      securityReportWriteSucceeded = true;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDoctorResult("FAIL", "Security verification", message);
    if (indicatesPermissionIssue(message)) {
      requiresSudo = true;
    }
  }

  try {
    const report = buildDoctorReportMarkdown(
      profileName,
      composePath,
      securityReportPath,
      doctorResults,
      doctorDiagnostics
    );
    fs.mkdirSync(path.dirname(doctorReportPath), { recursive: true });
    fs.writeFileSync(doctorReportPath, report, "utf8");
    doctorReportWriteSucceeded = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    addDoctorResult("FAIL", "Doctor report write", message);
    if (indicatesPermissionIssue(message)) {
      requiresSudo = true;
    }
  }

  const { passCount, warnCount, failCount } = summarizeCheckResults(doctorResults);
  for (const result of doctorResults) {
    if (result.status !== "PASS" && indicatesPermissionIssue(result.details)) {
      requiresSudo = true;
      break;
    }
  }

  return {
    passCount,
    warnCount,
    failCount,
    reportPath: doctorReportPath,
    reportWritten: doctorReportWriteSucceeded,
    securityReportPath,
    securityReportWritten: securityReportWriteSucceeded,
    version,
    commit,
    requiresSudo,
    verboseInfo
  };
}
