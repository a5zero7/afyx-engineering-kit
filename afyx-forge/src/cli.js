/**
 * Afyx Forge Core — CLI Interface
 */

import fs from 'node:fs';
import path from 'node:path';
import { createForgePlan, runDoctor, FORGE_CORE_VERSION } from './index.js';

function printHelp() {
  console.log(`
Afyx Forge Core v${FORGE_CORE_VERSION} — Standalone Adaptive Engineering Guidance Runtime

USAGE:
  afyx-forge <command> [options]

COMMANDS:
  plan      Formulate an actionable engineering plan and adaptive routing policy
  doctor    Diagnose agent surfaces, runtime components, and governance gates
  version   Display version and build metadata
  help      Display help information

OPTIONS for 'plan':
  --task <string>       Direct task description string
  --task-file <path>    Path to task markdown/text file
  --format <type>       Output format: 'json' (default) or 'markdown'
  --output <path>       Save result to specified file path instead of stdout

GLOBAL OPTIONS:
  -v, --version         Show version
  -h, --help            Show help

EXAMPLES:
  afyx-forge doctor
  afyx-forge plan --task "Fix NullPointerException in checkout payment settlement"
  afyx-forge plan --task-file ./task-description.md --format markdown
  afyx-forge plan --task-file ./task.md --output ./plan.json
`);
}

export async function runCli(args = process.argv.slice(2)) {
  if (args.length === 0 || args.includes('-h') || args.includes('--help') || args[0] === 'help') {
    printHelp();
    return 0;
  }

  if (args.includes('-v') || args.includes('--version') || args[0] === 'version') {
    console.log(`afyx-forge ${FORGE_CORE_VERSION} (Afyx Forge Core Alpha - Bounded Engineering Guidance)`);
    return 0;
  }

  const command = args[0];

  if (command === 'doctor') {
    const diagnostic = runDoctor();
    console.log(JSON.stringify(diagnostic, null, 2));
    return 0;
  }

  if (command === 'plan') {
    let taskText = '';
    let taskFile = '';
    let format = 'json';
    let outputPath = '';

    for (let i = 1; i < args.length; i++) {
      if (args[i] === '--task' && args[i + 1]) {
        taskText = args[++i];
      } else if (args[i] === '--task-file' && args[i + 1]) {
        taskFile = args[++i];
      } else if (args[i] === '--format' && args[i + 1]) {
        format = args[++i].toLowerCase();
      } else if (args[i] === '--output' && args[i + 1]) {
        outputPath = args[++i];
      }
    }

    if (!taskText && !taskFile) {
      console.error('Error: Either --task or --task-file must be provided for "plan".');
      return 1;
    }

    try {
      const plan = createForgePlan({ taskText, taskFile, format });
      const rendered = typeof plan === 'string' ? plan : JSON.stringify(plan, null, 2);

      if (outputPath) {
        const resolvedOut = path.resolve(outputPath);
        fs.mkdirSync(path.dirname(resolvedOut), { recursive: true });
        fs.writeFileSync(resolvedOut, rendered + '\n', 'utf8');
        console.log(`Plan written to: ${resolvedOut}`);
      } else {
        console.log(rendered);
      }

      // If refused unsafe, exit with status 2 to indicate safety refusal
      if (typeof plan === 'object' && plan.status === 'REFUSED_UNSAFE') {
        return 2;
      }

      return 0;
    } catch (err) {
      console.error(`Error: ${err.message}`);
      return 1;
    }
  }

  console.error(`Unknown command: ${command}`);
  printHelp();
  return 1;
}

