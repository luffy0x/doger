#!/usr/bin/env node

export const VERSION = "0.1.0";

export function helpText(): string {
  return [
    "doger, a jd-activity-keeper",
    "",
    "Usage: doger <command>",
    "",
    "Commands:",
    "  help       Show this help message",
    "  version    Show the installed version",
  ].join("\n");
}

export function run(argv: readonly string[]): number {
  const [command = "help"] = argv;

  if (command === "help" || command === "--help" || command === "-h") {
    process.stdout.write(`${helpText()}\n`);
    return 0;
  }

  if (command === "version" || command === "--version" || command === "-v") {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  process.stderr.write(`Unknown command: ${command}\n\n${helpText()}\n`);
  return 64;
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === new URL(process.argv[1], "file:").href;

if (isEntrypoint) {
  process.exitCode = run(process.argv.slice(2));
}
