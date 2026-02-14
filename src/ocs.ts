#!/usr/bin/env node

import { COMMAND_HANDLERS, OcsCommand } from "./commands";

const ALL_COMMANDS = Object.keys(COMMAND_HANDLERS).join(", ");

function printUsage(): void {
  console.log("Usage: ocs <command> [options]");
  console.log(`Commands: ${ALL_COMMANDS}`);
  console.log("Install options: --profile <name>");
  console.log("Verify options: --profile <name> --output <path> [--strict-ip-egress]");
  console.log("Doctor options: --profile <name> [--no-up] [--strict-ip-egress]");
  console.log("apply-firewall options: --profile <name>");
}

function isValidCommand(command: string): command is OcsCommand {
  return Object.prototype.hasOwnProperty.call(COMMAND_HANDLERS, command);
}

export function main(argv: string[] = process.argv): void {
  const command = argv[2];
  const args = argv.slice(3);

  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  if (!isValidCommand(command)) {
    console.error(`Unknown command: '${command}'`);
    printUsage();
    process.exitCode = 1;
    return;
  }

  try {
    COMMAND_HANDLERS[command](args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exitCode = 1;
  }
}

main();
