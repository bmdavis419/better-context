import { Command, Options } from '@effect/cli';
import {
	FileSystem,
	HttpRouter,
	HttpServer,
	HttpServerRequest,
	HttpServerResponse
} from '@effect/platform';
import { BunHttpServer } from '@effect/platform-bun';
import { Effect, Layer, Schema, Stream } from 'effect';
import * as readline from 'readline';
import { OcService, type OcEvent } from './oc.ts';
import { ConfigService } from './config.ts';

declare const __VERSION__: string;
const VERSION: string = typeof __VERSION__ !== 'undefined' ? __VERSION__ : '0.0.0-dev';

const programLayer = Layer.mergeAll(OcService.Default, ConfigService.Default);

// === Ask Subcommand ===
const questionOption = Options.text('question').pipe(Options.withAlias('q'));
const techOption = Options.text('tech').pipe(Options.withAlias('t'));

const askCommand = Command.make(
	'ask',
	{ question: questionOption, tech: techOption },
	({ question, tech }) =>
		Effect.gen(function* () {
			const oc = yield* OcService;
			const eventStream = yield* oc.askQuestion({ tech, question, suppressLogs: false });

			let currentMessageId: string | null = null;

			yield* eventStream.pipe(
				Stream.runForEach((event) =>
					Effect.sync(() => {
						switch (event.type) {
							case 'message.part.updated':
								if (event.properties.part.type === 'text') {
									if (currentMessageId === event.properties.part.messageID) {
										process.stdout.write(event.properties.delta ?? '');
									} else {
										currentMessageId = event.properties.part.messageID;
										process.stdout.write('\n\n' + event.properties.part.text);
									}
								}
								break;
							default:
								break;
						}
					})
				)
			);

			console.log('\n');
		}).pipe(
			Effect.catchTags({
				InvalidProviderError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown provider "${e.providerId}"`);
						console.error(`Available providers: ${e.availableProviders.join(', ')}`);
						process.exit(1);
					}),
				InvalidModelError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Unknown model "${e.modelId}" for provider "${e.providerId}"`);
						console.error(`Available models: ${e.availableModels.join(', ')}`);
						process.exit(1);
					}),
				ProviderNotConnectedError: (e) =>
					Effect.sync(() => {
						console.error(`Error: Provider "${e.providerId}" is not connected`);
						console.error(`Connected providers: ${e.connectedProviders.join(', ')}`);
						console.error(`Run "opencode auth" to configure provider credentials.`);
						process.exit(1);
					})
			}),
			Effect.provide(programLayer)
		)
);

// === Open Subcommand ===
const openCommand = Command.make('open', {}, () =>
	Effect.gen(function* () {
		const oc = yield* OcService;
		yield* oc.holdOpenInstanceInBg();
	}).pipe(Effect.provide(programLayer))
);

// === Chat Subcommand ===
const chatTechOption = Options.text('tech').pipe(Options.withAlias('t'));

const chatCommand = Command.make('chat', { tech: chatTechOption }, ({ tech }) =>
	Effect.gen(function* () {
		const oc = yield* OcService;
		yield* oc.spawnTui({ tech });
	}).pipe(Effect.provide(programLayer))
);

// === Serve Subcommand ===
const QuestionRequest = Schema.Struct({
	tech: Schema.String,
	question: Schema.String
});

const portOption = Options.integer('port').pipe(Options.withAlias('p'), Options.withDefault(8080));

const serveCommand = Command.make('serve', { port: portOption }, ({ port }) =>
	Effect.gen(function* () {
		const router = HttpRouter.empty.pipe(
			HttpRouter.post(
				'/question',
				Effect.gen(function* () {
					const body = yield* HttpServerRequest.schemaBodyJson(QuestionRequest);
					const oc = yield* OcService;

					const eventStream = yield* oc.askQuestion({
						tech: body.tech,
						question: body.question,
						suppressLogs: false
					});

					const chunks: string[] = [];
					let currentMessageId: string | null = null;
					yield* eventStream.pipe(
						Stream.runForEach((event) =>
							Effect.sync(() => {
								switch (event.type) {
									case 'message.part.updated':
										if (event.properties.part.type === 'text') {
											if (currentMessageId === event.properties.part.messageID) {
												chunks[chunks.length - 1] += event.properties.delta ?? '';
											} else {
												currentMessageId = event.properties.part.messageID;
												chunks.push(event.properties.part.text ?? '');
											}
										}
										break;
									default:
										break;
								}
							})
						)
					);

					return yield* HttpServerResponse.json({ answer: chunks.join('') });
				})
			)
		);

		const ServerLive = BunHttpServer.layer({ port });

		const HttpLive = router.pipe(
			HttpServer.serve(),
			HttpServer.withLogAddress,
			Layer.provide(ServerLive)
		);

		return yield* Layer.launch(HttpLive);
	}).pipe(Effect.scoped, Effect.provide(programLayer))
);

// === Config Subcommands ===

// config model - view or set model/provider
const providerOption = Options.text('provider').pipe(Options.withAlias('p'), Options.optional);
const modelOption = Options.text('model').pipe(Options.withAlias('m'), Options.optional);

const configModelCommand = Command.make(
	'model',
	{ provider: providerOption, model: modelOption },
	({ provider, model }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;

			// If both options provided, update the config
			if (provider._tag === 'Some' && model._tag === 'Some') {
				const result = yield* config.updateModel({
					provider: provider.value,
					model: model.value
				});
				console.log(`Updated model configuration:`);
				console.log(`  Provider: ${result.provider}`);
				console.log(`  Model: ${result.model}`);
			} else if (provider._tag === 'Some' || model._tag === 'Some') {
				// If only one is provided, show an error
				console.error('Error: Both --provider and --model must be specified together');
				process.exit(1);
			} else {
				// No options, show current values
				const current = yield* config.getModel();
				console.log(`Current model configuration:`);
				console.log(`  Provider: ${current.provider}`);
				console.log(`  Model: ${current.model}`);
			}
		}).pipe(Effect.provide(programLayer))
);

// config repos list - list all repos
const configReposListCommand = Command.make('list', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		const repos = yield* config.getRepos();

		if (repos.length === 0) {
			console.log('No repos configured.');
			return;
		}

		console.log('Configured repos:\n');
		for (const repo of repos) {
			console.log(`  ${repo.name}`);
			console.log(`    URL: ${repo.url}`);
			console.log(`    Branch: ${repo.branch}`);
			if (repo.specialNotes) {
				console.log(`    Notes: ${repo.specialNotes}`);
			}
			console.log();
		}
	}).pipe(Effect.provide(programLayer))
);

// config repos add - add a new repo
const repoNameOption = Options.text('name').pipe(Options.withAlias('n'));
const repoUrlOption = Options.text('url').pipe(Options.withAlias('u'));
const repoBranchOption = Options.text('branch').pipe(
	Options.withAlias('b'),
	Options.withDefault('main')
);
const repoNotesOption = Options.text('notes').pipe(Options.optional);

const configReposAddCommand = Command.make(
	'add',
	{
		name: repoNameOption.pipe(Options.optional),
		url: repoUrlOption.pipe(Options.optional),
		branch: repoBranchOption,
		notes: repoNotesOption
	},
	({ name, url, branch, notes }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;

			let repoName: string;
			if (name._tag === 'Some') {
				repoName = name.value;
			} else {
				repoName = yield* askText('Enter repo name: ');
			}

			if (!repoName) {
				console.log('No repo name provided.');
				return;
			}

			let repoUrl: string;
			if (url._tag === 'Some') {
				repoUrl = url.value;
			} else {
				repoUrl = yield* askText('Enter repo URL: ');
			}

			if (!repoUrl) {
				console.log('No repo URL provided.');
				return;
			}

			const repo = {
				name: repoName,
				url: repoUrl,
				branch,
				...(notes._tag === 'Some' ? { specialNotes: notes.value } : {})
			};

			yield* config.addRepo(repo);
			console.log(`Added repo "${repoName}":`);
			console.log(`  URL: ${repoUrl}`);
			console.log(`  Branch: ${branch}`);
			if (notes._tag === 'Some') {
				console.log(`  Notes: ${notes.value}`);
			}
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

// config repos clear - clear all downloaded repos
const askConfirmation = (question: string): Effect.Effect<boolean> =>
	Effect.async<boolean>((resume) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		rl.question(question, (answer) => {
			rl.close();
			const normalized = answer.toLowerCase().trim();
			resume(Effect.succeed(normalized === 'y' || normalized === 'yes'));
		});
	});

const askText = (question: string): Effect.Effect<string> =>
	Effect.async<string>((resume) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		rl.question(question, (answer) => {
			rl.close();
			resume(Effect.succeed(answer.trim()));
		});
	});

const configReposRemoveCommand = Command.make(
	'remove',
	{ name: repoNameOption.pipe(Options.optional) },
	({ name }) =>
		Effect.gen(function* () {
			const config = yield* ConfigService;

			let repoName: string;
			if (name._tag === 'Some') {
				repoName = name.value;
			} else {
				repoName = yield* askText('Enter repo name to remove: ');
			}

			if (!repoName) {
				console.log('No repo name provided.');
				return;
			}

			// Check if repo exists
			const repos = yield* config.getRepos();
			const exists = repos.find((r) => r.name === repoName);
			if (!exists) {
				console.error(`Error: Repo "${repoName}" not found.`);
				process.exit(1);
			}

			const confirmed = yield* askConfirmation(
				`Are you sure you want to remove repo "${repoName}" from config? (y/N): `
			);

			if (!confirmed) {
				console.log('Aborted.');
				return;
			}

			yield* config.removeRepo(repoName);
			console.log(`Removed repo "${repoName}".`);
		}).pipe(
			Effect.catchTag('ConfigError', (e) =>
				Effect.sync(() => {
					console.error(`Error: ${e.message}`);
					process.exit(1);
				})
			),
			Effect.provide(programLayer)
		)
);

const configReposClearCommand = Command.make('clear', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		const fs = yield* FileSystem.FileSystem;

		const reposDir = yield* config.getReposDirectory();

		// Check if repos directory exists
		const exists = yield* fs.exists(reposDir);
		if (!exists) {
			console.log('Repos directory does not exist. Nothing to clear.');
			return;
		}

		// List all directories in the repos directory
		const entries = yield* fs.readDirectory(reposDir);
		const repoPaths: string[] = [];

		for (const entry of entries) {
			const fullPath = `${reposDir}/${entry}`;
			const stat = yield* fs.stat(fullPath);
			if (stat.type === 'Directory') {
				repoPaths.push(fullPath);
			}
		}

		if (repoPaths.length === 0) {
			console.log('No repos found in the repos directory. Nothing to clear.');
			return;
		}

		console.log('The following repos will be deleted:\n');
		for (const repoPath of repoPaths) {
			console.log(`  ${repoPath}`);
		}
		console.log();

		const confirmed = yield* askConfirmation(
			'Are you sure you want to delete these repos? (y/N): '
		);

		if (!confirmed) {
			console.log('Aborted.');
			return;
		}

		for (const repoPath of repoPaths) {
			yield* fs.remove(repoPath, { recursive: true });
			console.log(`Deleted: ${repoPath}`);
		}

		console.log('\nAll repos have been cleared.');
	}).pipe(Effect.provide(programLayer))
);

// config repos - parent command for repo subcommands
const configReposCommand = Command.make('repos', {}, () =>
	Effect.sync(() => {
		console.log('Usage: btca config repos <command>');
		console.log('');
		console.log('Commands:');
		console.log('  list    List all configured repos');
		console.log('  add     Add a new repo');
		console.log('  remove  Remove a configured repo');
		console.log('  clear   Clear all downloaded repos');
	})
).pipe(
	Command.withSubcommands([
		configReposListCommand,
		configReposAddCommand,
		configReposRemoveCommand,
		configReposClearCommand
	])
);

// config - parent command
const configCommand = Command.make('config', {}, () =>
	Effect.gen(function* () {
		const config = yield* ConfigService;
		const configPath = yield* config.getConfigPath();

		console.log(`Config file: ${configPath}`);
		console.log('');
		console.log('Usage: btca config <command>');
		console.log('');
		console.log('Commands:');
		console.log('  model   View or set the model and provider');
		console.log('  repos   Manage configured repos');
	}).pipe(Effect.provide(programLayer))
).pipe(Command.withSubcommands([configModelCommand, configReposCommand]));

// === Main Command ===
const mainCommand = Command.make('btca', {}, () =>
	Effect.sync(() => {
		console.log(`btca v${VERSION}. run btca --help for more information.`);
	})
).pipe(
	Command.withSubcommands([askCommand, serveCommand, openCommand, chatCommand, configCommand])
);

const cliService = Effect.gen(function* () {
	return {
		run: (argv: string[]) =>
			Command.run(mainCommand, {
				name: 'btca',
				version: VERSION
			})(argv)
	};
});

export class CliService extends Effect.Service<CliService>()('CliService', {
	effect: cliService
}) {}

export { type OcEvent };
