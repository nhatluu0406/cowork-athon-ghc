// APP lifecycle CLI (CGHC-028 Wave B2b). Thin arg-parse + dispatch; ALL logic lives in
// commands.mjs (testable behind injectable seams). This is the neutral CLI the four Windows
// .bat entry points call: `node tools/app/cli.mjs <init|start|stop|clean|status> --root <path>`.
//
// Never requires Administrator, never changes execution policy, never downloads unverified
// executables, never fakes success. Exit codes are honest (see commands.mjs EXIT).

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cmdInit, cmdStart, cmdStop, cmdClean, cmdStatus } from './commands.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_ROOT = resolve(HERE, '..', '..');

export function main(argv = process.argv.slice(2)) {
  const cmd = argv[0];
  const rootArg = argv.includes('--root') ? argv[argv.indexOf('--root') + 1] : null;
  const root = rootArg ? resolve(rootArg) : DEFAULT_ROOT;
  const confirmed = argv.includes('--yes');
  switch (cmd) {
    case 'init': return cmdInit(root);
    case 'start': return cmdStart(root);
    case 'stop': return cmdStop(root);
    case 'clean': return cmdClean(root, confirmed);
    case 'status': return cmdStatus(root);
    default:
      process.stdout.write('usage: cli.mjs <init|start|stop|clean|status> [--root <path>] [--yes]\n');
      return 1;
  }
}

const invokedDirectly =
  import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('cli.mjs');
if (invokedDirectly) {
  process.exit(main());
}

export default { main, DEFAULT_ROOT };
