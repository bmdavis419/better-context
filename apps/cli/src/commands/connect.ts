import select from '@inquirer/select';
import * as readline from 'readline';
import { spawn } from 'bun';
import { Effect } from 'effect';
import { withServerEffect } from '../server/manager.ts';
import { createClient, getProvidersEffect, updateModelEffect } from '../client/index.ts';
import { dim, green } from '../lib/utils/colors.ts';
import { loginCopilotOAuth } from '../lib/copilot-oauth.ts';
import { loginOpenAIOAuth, saveProviderApiKey } from '../lib/opencode-oauth.ts';
import {
	CURATED_MODELS,
	PROVIDER_AUTH_GUIDANCE,
	PROVIDER_INFO,
	PROVIDER_MODEL_DOCS,
	PROVIDER_MODEL_WARNINGS,
	PROVIDER_SETUP_LINKS
} from '../connect/constants.ts';

const isPromptCancelled = (error: unknown) =>
	error instanceof Error &&
	(error.name === 'ExitPromptError' ||
		error.message.toLowerCase().includes('canceled') ||
		error.message.toLowerCase().includes('cancelled'));

/**
 * Create a readline interface for prompts.
 */
function createRl(): readline.Interface {
	return readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});
}

/**
 * Prompt for input with a default value.
 */
async function promptInput(
	rl: readline.Interface,
	question: string,
	defaultValue?: string
): Promise<string> {
	return new Promise((resolve) => {
		const defaultHint = defaultValue ? ` ${dim(`(${defaultValue})`)}` : '';
		rl.question(`${question}${defaultHint}: `, (answer) => {
			const value = answer.trim();
			resolve(value || defaultValue || '');
		});
	});
}

const promptSelectNumeric = <T extends string>(
	question: string,
	options: { label: string; value: T }[]
) =>
	new Promise<T>((resolve, reject) => {
		const rl = readline.createInterface({
			input: process.stdin,
			output: process.stdout
		});

		console.log(`\n${question}\n`);
		options.forEach((opt, idx) => {
			console.log(`  ${idx + 1}) ${opt.label}`);
		});
		console.log('');

		rl.question('Enter number: ', (answer) => {
			rl.close();
			const num = parseInt(answer.trim(), 10);
			if (isNaN(num) || num < 1 || num > options.length) {
				reject(new Error('Invalid selection'));
				return;
			}
			resolve(options[num - 1]!.value);
		});
	});

/**
 * Prompt for single selection from a list.
 */
const promptSelect = async <T extends string>(
	question: string,
	options: { label: string; value: T }[]
) => {
	if (options.length === 0) {
		throw new Error('Invalid selection');
	}

	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		return promptSelectNumeric(question, options);
	}

	const selection = await select({
		message: question,
		choices: options.map((option) => ({
			name: option.label,
			value: option.value
		}))
	});
	return selection as T;
};

/**
 * Run opencode auth flow for a provider.
 */
async function runOpencodeAuth(providerId: string): Promise<boolean> {
	console.log(`\nOpening browser for ${providerId} authentication...`);
	console.log('(This requires OpenCode CLI to be installed)\n');

	try {
		const proc = spawn(['opencode', 'auth', '--provider', providerId], {
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit'
		});

		const exitCode = await proc.exited;
		return exitCode === 0;
	} catch (error) {
		console.error(
			'Failed to run opencode auth:',
			error instanceof Error ? error.message : String(error)
		);
		console.error('\nMake sure OpenCode CLI is installed: bun add -g opencode-ai');
		return false;
	}
}

async function runBtcaAuth(providerId: string): Promise<boolean> {
	if (providerId === 'openai') {
		console.log('\nStarting OpenAI OAuth flow...');
		const result = await loginOpenAIOAuth();
		if (!result.ok) {
			console.error(`Failed to authenticate with OpenAI: ${result.error}`);
			return false;
		}
		console.log('OpenAI authentication complete.');
		return true;
	}

	if (providerId === 'github-copilot') {
		console.log('\nStarting GitHub Copilot device flow...');
		const result = await loginCopilotOAuth();
		if (!result.ok) {
			console.error(`Failed to authenticate with GitHub Copilot: ${result.error}`);
			return false;
		}
		console.log('GitHub Copilot authentication complete.');
		return true;
	}

	if (
		providerId === 'atlascloud' ||
		providerId === 'opencode' ||
		providerId === 'openrouter' ||
		providerId === 'anthropic' ||
		providerId === 'minimax' ||
		providerId === 'google'
	) {
		const setup = PROVIDER_SETUP_LINKS[providerId];
		if (setup) {
			console.log(`\n${setup.label}: ${setup.url}`);
		}
		const rl = createRl();
		const key = await promptInput(rl, 'Enter API key');
		rl.close();
		if (!key) {
			console.error('API key is required.');
			return false;
		}
		await saveProviderApiKey(providerId, key);
		console.log(`${providerId} API key saved.`);
		return true;
	}

	return runOpencodeAuth(providerId);
}

const promptOpenAICompatSetup = async (options: { includeModel?: boolean } = {}) => {
	const includeModel = options.includeModel ?? true;
	const rl = createRl();
	try {
		const baseURL = await promptInput(rl, 'Base URL');
		const name = await promptInput(rl, 'Provider name');
		const modelId = includeModel ? await promptInput(rl, 'Model ID') : '';
		const apiKey = await promptInput(rl, 'API key (optional)');
		return { baseURL, name, modelId, apiKey };
	} finally {
		rl.close();
	}
};

export const runConnectCommand = (args: {
	global?: boolean;
	provider?: string;
	model?: string;
	globalOpts?: { server?: string; port?: number };
}) =>
	withServerEffect(
		{
			serverUrl: args.globalOpts?.server,
			port: args.globalOpts?.port,
			quiet: true
		},
		(server) =>
			Effect.gen(function* () {
				try {
					const client = createClient(server.url);
					const providers = yield* getProvidersEffect(client);

					if (args.provider && args.model) {
						if (args.provider === 'openai-compat') {
							const { baseURL, name, apiKey } = yield* Effect.tryPromise(() =>
								promptOpenAICompatSetup({ includeModel: false })
							);
							if (!baseURL || !name) {
								return yield* Effect.fail(new Error('Base URL and provider name are required.'));
							}
							if (apiKey) {
								yield* Effect.tryPromise(() => saveProviderApiKey(args.provider!, apiKey));
								yield* Effect.sync(() => console.log(`${args.provider} API key saved.`));
							}
							const updated = yield* updateModelEffect(server.url, args.provider, args.model, {
								baseURL,
								name
							});
							yield* Effect.sync(() =>
								console.log(`Model updated: ${updated.provider}/${updated.model}`)
							);
							return;
						}

						const updated = yield* updateModelEffect(server.url, args.provider, args.model);
						yield* Effect.sync(() =>
							console.log(`Model updated: ${updated.provider}/${updated.model}`)
						);

						const info = PROVIDER_INFO[args.provider];
						if (info?.requiresAuth && !providers.connected.includes(args.provider)) {
							yield* Effect.sync(() => {
								console.warn(`\nWarning: Provider "${args.provider}" is not connected.`);
								console.warn('Run "opencode auth" to configure credentials.');
							});
						}
						return;
					}

					yield* Effect.sync(() => console.log('\n--- Configure AI Provider ---\n'));
					const providerOptions: { label: string; value: string }[] = [];

					for (const connectedId of providers.connected) {
						const info = PROVIDER_INFO[connectedId];
						const label = info
							? `${info.label} ${green('(connected)')}`
							: `${connectedId} ${green('(connected)')}`;
						providerOptions.push({ label, value: connectedId });
					}

					for (const provider of providers.all) {
						if (!providers.connected.includes(provider.id)) {
							const info = PROVIDER_INFO[provider.id];
							const label = info ? info.label : provider.id;
							providerOptions.push({ label, value: provider.id });
						}
					}

					const provider = yield* Effect.tryPromise(() =>
						promptSelect('Select a provider:', providerOptions)
					);
					const isConnected = providers.connected.includes(provider);
					const info = PROVIDER_INFO[provider];

					if (!isConnected && info?.requiresAuth) {
						yield* Effect.sync(() =>
							console.log(`\nProvider "${provider}" requires authentication.`)
						);
						const guidance = PROVIDER_AUTH_GUIDANCE[provider];
						if (guidance) {
							yield* Effect.sync(() => console.log(`\n${guidance}`));
						}
						const success = yield* Effect.tryPromise(() => runBtcaAuth(provider));
						if (!success) {
							return yield* Effect.fail(
								new Error('Authentication may have failed. Try again later with: opencode auth.')
							);
						}
					}

					if (provider === 'openai-compat') {
						const modelDocs = PROVIDER_MODEL_DOCS[provider];
						if (modelDocs) {
							yield* Effect.sync(() => console.log(`\n${modelDocs.label}: ${modelDocs.url}`));
						}

						const { baseURL, name, modelId, apiKey } = yield* Effect.tryPromise(() =>
							promptOpenAICompatSetup()
						);
						if (!baseURL || !name || !modelId) {
							return yield* Effect.fail(
								new Error('Base URL, provider name, and model ID are required.')
							);
						}
						if (apiKey) {
							yield* Effect.tryPromise(() => saveProviderApiKey(provider, apiKey));
							yield* Effect.sync(() => console.log(`${provider} API key saved.`));
						}

						const updated = yield* updateModelEffect(server.url, provider, modelId, {
							baseURL,
							name
						});
						yield* Effect.sync(() => {
							console.log(`\nModel configured: ${updated.provider}/${updated.model}`);
							console.log(`\nSaved to: ${updated.savedTo} config`);
						});
						return;
					}

					let model: string;
					const curated = CURATED_MODELS[provider] ?? [];
					const modelDocs = PROVIDER_MODEL_DOCS[provider];
					const modelWarning = PROVIDER_MODEL_WARNINGS[provider];
					if (modelDocs) {
						yield* Effect.sync(() => console.log(`\n${modelDocs.label}: ${modelDocs.url}`));
					}
					if (modelWarning) {
						yield* Effect.sync(() => console.log(`\nHeads-up: ${modelWarning}`));
					}

					if (curated.length > 0) {
						const options = [
							...curated.map((modelItem) => ({ label: modelItem.label, value: modelItem.id })),
							{ label: 'Custom model ID...', value: '__custom__' }
						];
						const selection = yield* Effect.tryPromise(() =>
							promptSelect('Select a model:', options)
						);
						if (selection === '__custom__') {
							const rl = createRl();
							model = yield* Effect.tryPromise(() => promptInput(rl, 'Enter model ID'));
							rl.close();
						} else {
							model = selection;
						}
					} else {
						yield* Effect.sync(() =>
							console.log(`\nCurated models for ${provider} are coming soon.`)
						);
						const rl = createRl();
						model = yield* Effect.tryPromise(() => promptInput(rl, 'Enter model ID'));
						rl.close();
					}

					if (!model) {
						return yield* Effect.fail(new Error('Model ID is required.'));
					}

					const updated = yield* updateModelEffect(server.url, provider, model);
					yield* Effect.sync(() => {
						console.log(`\nModel configured: ${updated.provider}/${updated.model}`);
						console.log(`\nSaved to: ${updated.savedTo} config`);
					});
				} catch (error) {
					if (error instanceof Error && error.message === 'Invalid selection') {
						return yield* Effect.fail(new Error('Invalid selection. Please try again.'));
					}
					if (isPromptCancelled(error)) {
						yield* Effect.sync(() => {
							console.log('\nSelection cancelled.');
						});
						return;
					}
					return yield* Effect.fail(error);
				}
			})
	);
