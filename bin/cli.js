#!/usr/bin/env node
/**
 * i18n-rosetta CLI — Dispatcher
 *
 * Thin entry point that parses arguments and routes to command modules
 * in lib/commands/. Each command is a separate module exporting:
 *   async function run(args, cwd) → exit code (0 or 1)
 *
 * This file handles ONLY:
 *   1. Argument parsing (zero-dependency)
 *   2. Command routing
 *   3. Per-command --help routing
 *   4. Process exit codes
 *   5. Top-level error handling
 */

// -----------------------------------------------------------------
// Parse CLI arguments (zero-dependency, handles --key value pairs)
// -----------------------------------------------------------------
function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 2; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) {
        args[key] = next;
        i++;
      } else {
        args[key] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

const args = parseArgs(process.argv);
const command = args._[0] || 'help';
const cwd = process.cwd();

// -----------------------------------------------------------------
// --version: print version from package.json and exit
// -----------------------------------------------------------------
if (args.version) {
  import('node:fs').then(fs => {
    import('node:url').then(url => {
      const pkgPath = new URL('../package.json', import.meta.url);
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      console.log(`i18n-rosetta v${pkg.version}`);
      process.exit(0);
    });
  });
} else

// -----------------------------------------------------------------
// Per-command --help: intercept before loading command modules
// If the user runs `rosetta <cmd> --help`, show focused help for
// that command without loading its module (fast, no side effects).
// -----------------------------------------------------------------
if (args.help && command !== 'help') {
  import('../lib/command-help.js').then(({ showCommandHelp }) => {
    const found = showCommandHelp(command);
    if (!found) {
      console.error(`[ERR] Unknown command: ${command}`);
      console.error('       Run "i18n-rosetta help" to see all commands.');
      process.exit(1);
    }
    process.exit(0);
  });
} else {
  // -----------------------------------------------------------------
  // Command routing — dynamic import() keeps startup fast (ESM-native)
  // -----------------------------------------------------------------
  const commands = {
    init:       () => import('../lib/commands/init.js'),
    sync:       () => import('../lib/commands/sync.js'),
    watch:      () => import('../lib/commands/watch.js'),
    audit:      () => import('../lib/commands/audit.js'),
    lint:       () => import('../lib/commands/lint.js'),
    status:     () => import('../lib/commands/status.js'),
    provenance: () => import('../lib/commands/provenance.js'),
    wrap:       () => import('../lib/commands/wrap.js'),
    seo:        () => import('../lib/commands/seo.js'),
    integrity:  () => import('../lib/commands/integrity.js'),
    plugin:     () => import('../lib/commands/plugin.js'),
  };

  if (commands[command]) {
    commands[command]()
      .then(mod => mod.run(args, cwd))
      .then(code => process.exit(code || 0))
      .catch(err => {
        console.error(`[ERR] ${command} failed:`, err.message);
        process.exit(1);
      });
  } else if (command === 'help') {
    import('../lib/commands/help.js').then(mod => mod.run());
  } else {
    // Unknown command — error loudly so CI typos don't silently pass
    console.error(`[ERR] Unknown command: "${command}"`);
    console.error('      Run "i18n-rosetta help" to see all commands.');
    process.exit(1);
  }
}
