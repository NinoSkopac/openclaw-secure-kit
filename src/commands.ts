import { applyFirewall, rollbackFirewall } from "./firewall";
import { writeInstallArtifacts } from "./install-artifacts";
import { loadProfile } from "./profile-loader";
import { verifyProfile } from "./verifier";

export type OcsCommand = "install" | "verify" | "apply-firewall" | "rollback-firewall";

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

const install: CommandHandler = (args) => {
  const profileName = parseOptionArg("install", "profile", args);
  const profile = loadProfile(profileName);
  writeInstallArtifacts(profileName, profile);
  console.log(JSON.stringify(profile, null, 2));
};

const verifyCommand: CommandHandler = (args) => {
  const profileName = parseOptionArg("verify", "profile", args);
  const outputPath = parseOptionArg("verify", "output", args);
  const summary = verifyProfile(profileName, outputPath);

  console.log(`Wrote security report to ${outputPath}`);
  console.log(`PASS: ${summary.passCount}  FAIL: ${summary.failCount}`);

  if (summary.failCount > 0) {
    throw new Error(`Verification failed with ${summary.failCount} failed check(s).`);
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
  "apply-firewall": applyFirewallCommand,
  "rollback-firewall": rollbackFirewallCommand
};
