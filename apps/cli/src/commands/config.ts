import { Result } from 'better-result';
import { Command } from 'commander';

import { updateModel } from '../client/index.ts';
import { ensureServer } from '../server/manager.ts';

const configModelCommand = new Command('model')
	.description('Deprecated alias for "btca connect --provider ... --model ..."')
	.requiredOption('-p, --provider <id>', 'Provider ID')
	.requiredOption('-m, --model <id>', 'Model ID')
	.action(async (options: { provider: string; model: string }, command) => {
		const root = command.parent?.parent;
		const globalOpts = root?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const updated = await updateModel(server.url, options.provider, options.model);
			server.stop();

			console.warn(
				'Deprecation: "btca config model" will be removed in a future release. Use "btca connect --provider ... --model ...".'
			);
			console.log(`Model updated: ${updated.provider}/${updated.model}`);
		});

		if (Result.isError(result)) {
			const message = result.error instanceof Error ? result.error.message : String(result.error);
			console.error(`Error: ${message}`);
			process.exit(1);
		}
	});

export const configCommand = new Command('config')
	.description('Deprecated config command compatibility aliases')
	.addCommand(configModelCommand);
