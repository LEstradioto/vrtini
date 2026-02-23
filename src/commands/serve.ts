import type { Command } from 'commander';

export function registerServeCommand(program: Command): void {
  program
    .command('serve')
    .description('Start the vrtini web UI server')
    .option('-p, --port <port>', 'Port number', '4173')
    .option('--host <host>', 'Host to bind', '127.0.0.1')
    .option('-o, --open', 'Open browser automatically')
    .action(async (options) => {
      const { startServer } = await import('../../web/server/index.js');
      const port = Number.parseInt(options.port, 10);
      const host = options.host;
      await startServer({
        port,
        host,
        open: options.open,
      });
    });
}
