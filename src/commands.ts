import path from "node:path";

import { applyFirewall, rollbackFirewall } from "./firewall";
import { doctorProfile, shouldDoctorExit } from "./doctor";
import { writeInstallArtifacts } from "./install-artifacts";
import { loadProfile } from "./profile-loader";
import { verifyProfile } from "./verifier";

export type OcsCommand = "install" | "verify" | "doctor" | "apply-firewall" | "rollback-firewall";

type CommandHandler = (args: string[]) => void;

function parseOptionArg(command: string, flag: string, args: string[]): string {
  const exact = `--${flag}`;
  const inlinePrefix = `${exact}=`;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === exact) {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error(`${command} requires --${flag} <value>`);
      }
      return value;
    }

    if (token.startsWith(inlinePrefix)) {
      const value = token.split("=")[1];
      if (!value) {
        throw new Error(`${command} requires --${flag} <value>`);
      }
      return value;
    }
  }

  throw new Error(`${command} requires --${flag} <value>`);
}

function hasFlag(flag: string, args: string[]): boolean {
  const exact = `--${flag}`;
  return args.some((token) => token === exact);
}

const install: CommandHandler = (args) => {
  const profileName = parseOptionArg("install", "profile", args);
  const profile = loadProfile(profileName);
  const artifacts = writeInstallArtifacts(profileName, profile);
  const relativeOutDir = path.relative(process.cwd(), artifacts.outDir) || ".";
  const relativeEnvPath = path.relative(process.cwd(), artifacts.envPath) || ".env";
  const composePath = `${relativeOutDir}/docker-compose.yml`;
  const canonicalComposeUp = `docker compose -f ${composePath} --env-file ${relativeEnvPath} up -d`;
  const convenienceComposeUp = `cd ${relativeOutDir} && docker compose --env-file .env up -d`;

  console.log(JSON.stringify(profile, null, 2));
  console.log("");
  console.log(`Artifacts written to: ${relativeOutDir}`);
  console.log(
    `Gateway token is stored in ${relativeEnvPath} (${artifacts.gatewayTokenGenerated ? "generated" : "reused"}; not printed).`
  );
  console.log(`Selected gateway port: ${artifacts.selectedGatewayPort} (stored in .env)`);
  console.log(`Selected bridge port: ${artifacts.selectedBridgePort} (stored in .env)`);
  if (artifacts.portsAutoAdjusted) {
    console.log("Ports were auto-adjusted due to collision; see .env for active values.");
  }
  console.log("");
  console.log("Next steps:");
  console.log(canonicalComposeUp);
  console.log(`# Optional when already in ${relativeOutDir}:`);
  console.log(convenienceComposeUp);
  console.log(`docker compose -f ${composePath} --env-file ${relativeEnvPath} logs --tail=50 openclaw-gateway`);
  console.log(`docker compose -f ${composePath} --env-file ${relativeEnvPath} run --rm openclaw-cli --help`);
  console.log("A) Set Telegram bot token in .env (TELEGRAM_BOT_TOKEN=...)");
  console.log("   Optional: set TELEGRAM_CHAT_ID=... if your workflow requires it.");
  console.log(`cd ${relativeOutDir}`);
  console.log("set -a && . ./.env && set +a");
  console.log("B) Register Telegram channel with OpenClaw (gateway auth uses OPENCLAW_GATEWAY_TOKEN):");
  console.log(
    "docker compose --env-file .env run --rm -e OPENCLAW_GATEWAY_TOKEN=\"$OPENCLAW_GATEWAY_TOKEN\" openclaw-cli channels add --channel telegram --token \"$TELEGRAM_BOT_TOKEN\""
  );
};

const verifyCommand: CommandHandler = (args) => {
  const profileName = parseOptionArg("verify", "profile", args);
  const outputPath = parseOptionArg("verify", "output", args);
  const strictIpEgress = hasFlag("strict-ip-egress", args);
  const summary = verifyProfile(profileName, outputPath, {
    directIpPolicyOverride: strictIpEgress ? "fail" : undefined
  });

  console.log(`Wrote security report to ${outputPath}`);
  console.log(`PASS: ${summary.passCount}  WARN: ${summary.warnCount}  FAIL: ${summary.failCount}`);

  if (summary.failCount > 0) {
    throw new Error(`Verification failed with ${summary.failCount} failed check(s).`);
  }
};

const doctorCommand: CommandHandler = (args) => {
  const profileName = parseOptionArg("doctor", "profile", args);
  const noUp = hasFlag("no-up", args);
  const strictIpEgress = hasFlag("strict-ip-egress", args);
  const verbose = hasFlag("verbose", args);
  const summary = doctorProfile(profileName, {
    noUp,
    directIpPolicyOverride: strictIpEgress ? "fail" : undefined,
    verbose
  });

  const relativeDoctorReportPath = path.relative(process.cwd(), summary.reportPath) || summary.reportPath;
  const relativeSecurityReportPath =
    path.relative(process.cwd(), summary.securityReportPath) || summary.securityReportPath;
  console.log(`Version: ${summary.version} (${summary.commit})`);
  if (summary.reportWritten) {
    console.log(`Wrote doctor report to ${relativeDoctorReportPath}`);
  } else {
    console.log(`Could not write doctor report to ${relativeDoctorReportPath}`);
  }
  if (summary.securityReportWritten) {
    console.log(`Wrote security report to ${relativeSecurityReportPath}`);
  } else {
    console.log(`Could not write security report to ${relativeSecurityReportPath}`);
  }
  if (verbose && summary.verboseInfo.length > 0) {
    for (const infoLine of summary.verboseInfo) {
      console.log(infoLine);
    }
  }
  console.log(`PASS: ${summary.passCount}  WARN: ${summary.warnCount}  FAIL: ${summary.failCount}`);

  if (shouldDoctorExit(summary) && summary.requiresSudo) {
    console.error("Some checks require elevated privileges. Re-run with sudo.");
  }

  if (shouldDoctorExit(summary)) {
    throw new Error(`Doctor failed with ${summary.failCount} failing check(s).`);
  }
};

const applyFirewallCommand: CommandHandler = (args) => {
  const profileName = parseOptionArg("apply-firewall", "profile", args);
  applyFirewall(profileName);
};

const rollbackFirewallCommand: CommandHandler = () => {
  rollbackFirewall();
};

export const COMMAND_HANDLERS: Record<OcsCommand, CommandHandler> = {
  install,
  verify: verifyCommand,
  doctor: doctorCommand,
  "apply-firewall": applyFirewallCommand,
  "rollback-firewall": rollbackFirewallCommand
};
