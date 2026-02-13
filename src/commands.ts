import { writeInstallArtifacts } from "./install-artifacts";
import { loadProfile } from "./profile-loader";

export type OcsCommand = "install" | "verify" | "apply-firewall" | "rollback-firewall";

type CommandHandler = (args: string[]) => void;

function parseProfileArg(args: string[]): string {
  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--profile") {
      const value = args[index + 1];
      if (!value || value.startsWith("-")) {
        throw new Error("install requires --profile <name>");
      }
      return value;
    }

    if (token.startsWith("--profile=")) {
      const value = token.split("=")[1];
      if (!value) {
        throw new Error("install requires --profile <name>");
      }
      return value;
    }
  }

  throw new Error("install requires --profile <name>");
}

const install: CommandHandler = (args) => {
  const profileName = parseProfileArg(args);
  const profile = loadProfile(profileName);
  writeInstallArtifacts(profileName, profile);
  console.log(JSON.stringify(profile, null, 2));
};

const notImplemented = (command: Exclude<OcsCommand, "install">): CommandHandler => {
  return () => {
    console.log(`'${command}' is a stub command in Phase 0.`);
  };
};

export const COMMAND_HANDLERS: Record<OcsCommand, CommandHandler> = {
  install,
  verify: notImplemented("verify"),
  "apply-firewall": notImplemented("apply-firewall"),
  "rollback-firewall": notImplemented("rollback-firewall")
};
