import { Command } from 'commander';
import {
  registerInitCommand,
  registerBuildCommand,
  registerCrossCompareCommand,
  registerListBrowsersCommand,
  registerTestCommand,
  registerApproveCommand,
  registerServeCommand,
  registerReportCommand,
} from './commands/index.js';

export function createCli(): Command {
  const program = new Command();

  program.name('vrt').description('Visual Regression Testing tool').version('0.1.0');

  const registerCommands = [
    registerInitCommand,
    registerBuildCommand,
    registerCrossCompareCommand,
    registerListBrowsersCommand,
    registerTestCommand,
    registerApproveCommand,
    registerServeCommand,
    registerReportCommand,
  ];

  registerCommands.forEach((register) => register(program));

  return program;
}
