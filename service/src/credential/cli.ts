/**
 * Provider-key ingestion CLI entry (CGHC provider-key ingestion, SEC-1/SEC-2).
 *
 * `main()` is the production composition root: it wires the REAL Windows Credential Manager
 * store (`createKeyringStore`) and the REAL no-echo hidden prompt (`promptHiddenSecret`)
 * into the pure command logic (`cli-commands.ts`). The secret is read ONLY at the hidden
 * prompt — never from argv, an env var, or a file — so nothing sensitive ever reaches the
 * process arguments, the shell history, the terminal echo, disk, or a log line.
 *
 * Usage:
 *   node --import tsx service/src/credential/cli.ts set    [providerId]
 *   node --import tsx service/src/credential/cli.ts status [providerId]
 *   node --import tsx service/src/credential/cli.ts remove [providerId]
 * providerId defaults to the custom OpenAI-compatible endpoint (alias: `custom`).
 */

import { pathToFileURL } from "node:url";
import { createKeyringStore, KeyringUnavailableError } from "./keyring-adapter.js";
import { promptHiddenSecret } from "./hidden-prompt.js";
import {
  EXIT,
  runRemove,
  runSet,
  runStatus,
  type CliDeps,
} from "./cli-commands.js";

const USAGE =
  "Usage: set|status|remove [providerId]\n" +
  "  providerId defaults to the custom OpenAI-compatible endpoint (alias: custom).\n" +
  "  The API key for `set` is typed at a hidden local prompt — never on the command line.";

type Subcommand = "set" | "status" | "remove";

function isSubcommand(value: string | undefined): value is Subcommand {
  return value === "set" || value === "status" || value === "remove";
}

/**
 * Parse argv and run the requested subcommand against the REAL keyring + hidden prompt.
 * Returns a process exit code; never throws a raw stack trace to the user.
 */
export async function main(argv: readonly string[]): Promise<number> {
  const [subcommand, providerId] = argv;
  if (!isSubcommand(subcommand)) {
    process.stdout.write(USAGE + "\n");
    return EXIT.USAGE;
  }

  let store;
  try {
    store = await createKeyringStore();
  } catch (err) {
    const why =
      err instanceof KeyringUnavailableError
        ? "Windows Credential Manager is unavailable in this environment."
        : "could not open the OS credential store.";
    process.stdout.write(`error: ${why}\n`);
    return EXIT.STORE_ERROR;
  }

  const deps: CliDeps = {
    store,
    promptSecret: promptHiddenSecret,
    emit: (line) => process.stdout.write(line + "\n"),
  };

  switch (subcommand) {
    case "set":
      return runSet(deps, providerId);
    case "status":
      return runStatus(deps, providerId);
    case "remove":
      return runRemove(deps, providerId);
  }
}

// Run only when invoked directly (not when imported by a test).
const entry = process.argv[1];
const invokedDirectly = entry !== undefined && import.meta.url === pathToFileURL(entry).href;

if (invokedDirectly) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch(() => {
      // No secret is ever in flight here (a prompt failure is handled in-command); emit a
      // generic, secret-free message rather than a raw stack trace.
      process.stdout.write("error: unexpected failure.\n");
      process.exitCode = 1;
    });
}
