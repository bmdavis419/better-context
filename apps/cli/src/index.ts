import { BunContext, BunRuntime } from '@effect/platform-bun';
import { Cause, Effect, Exit } from 'effect';
import { CliService } from './services/cli.ts';
import { launchTui } from './tui-solid/index.tsx';

// Check if no arguments provided (just "btca" or "bunx btca")
const hasNoArgs = process.argv.length <= 2;

if (hasNoArgs) {
	// Launch the TUI
	launchTui();
} else {
	// Run the CLI with arguments
	Effect.gen(function* () {
		const cli = yield* CliService;
		yield* cli.run(process.argv);
	}).pipe(
		Effect.provide(CliService.Default),
		Effect.provide(BunContext.layer),
		BunRuntime.runMain({
			teardown: (exit) => {
				// Force exit: opencode SDK's server.close() sends SIGTERM but doesn't
				// wait for child process termination, keeping Node's event loop alive
				const code = Exit.isFailure(exit) && !Cause.isInterruptedOnly(exit.cause) ? 1 : 0;
				process.exit(code);
			}
		})
	);
}
