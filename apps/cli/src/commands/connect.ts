import { Result } from 'better-result';
import { Command } from 'commander';
import select from '@inquirer/select';
import * as readline from 'readline';
import { spawn } from 'bun';
import { ensureServer } from '../server/manager.ts';
import { createClient, getProviders, updateModel, BtcaError } from '../client/index.ts';
import { dim, green } from '../lib/utils/colors.ts';
import { loginOpenAIOAuth, saveProviderApiKey } from '../lib/opencode-oauth.ts';

const CURATED_MODELS: Record<string, { id: string; label: string }[]> = {
	openai: [{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }],
	opencode: [
		{ id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5' },
		{ id: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5' },
		{ id: 'gemini-3-flash', label: 'Gemini 3 Flash' },
		{ id: 'glm-4.7', label: 'GLM 4.7' },
		{ id: 'kimi-k2.5', label: 'Kimi K2.5' },
		{ id: 'gpt-5.2-codex', label: 'GPT-5.2 Codex' }
	],
	openrouter: [
		{ id: 'anthropic/claude-haiku-4.5', label: 'Anthropic Claude Haiku 4.5' },
		{ id: 'openai/gpt-5.2-codex', label: 'OpenAI GPT-5.2 Codex' },
		{ id: 'minimax/minimax-m2.1', label: 'MiniMax M2.1' },
		{ id: 'moonshotai/kimi-k2.5', label: 'Moonshot Kimi K2.5' }
	],
	anthropic: [
		{ id: 'claude-haiku-4-5-20251001', label: 'Claude Haiku 4.5 (2025-10-01)' },
		{ id: 'claude-sonnet-4-5-20250929', label: 'Claude Sonnet 4.5 (2025-09-29)' }
	],
	google: [{ id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash Preview' }]
};

// Provider display info
const PROVIDER_INFO: Record<string, { label: string; requiresAuth: boolean }> = {
	opencode: { label: 'OpenCode Zen', requiresAuth: true },
	anthropic: { label: 'Anthropic (Claude)', requiresAuth: true },
	openai: { label: 'OpenAI (GPT)', requiresAuth: true },
	google: { label: 'Google (Gemini)', requiresAuth: true },
	openrouter: { label: 'OpenRouter', requiresAuth: true }
};

const PROVIDER_AUTH_GUIDANCE: Record<string, string> = {
	openai: 'OpenAI requires OAuth: btca will open a browser to sign in.',
	anthropic: 'Anthropic uses API keys: paste your API key to continue.',
	google: 'Google uses API keys: paste your API key to continue.',
	openrouter: 'OpenRouter uses API keys: paste your API key to continue.',
	opencode: 'OpenCode uses API keys: paste your API key to continue.'
};

const PROVIDER_SETUP_LINKS: Record<string, { label: string; url: string }> = {
	opencode: { label: 'Get OpenCode Zen API key', url: 'https://opencode.ai/zen' },
	openrouter: { label: 'Get OpenRouter API key', url: 'https://openrouter.ai/settings/keys' },
	google: { label: 'Get Google API key', url: 'https://aistudio.google.com/api-keys' },
	anthropic: { label: 'Get Anthropic API key', url: 'https://platform.claude.com/dashboard' }
};

/**
 * Format an error for display, including hint if available.
 */
function formatError(error: unknown): string {
	if (error instanceof BtcaError) {
		let output = `Error: ${error.message}`;
		if (error.hint) {
			output += `\n\nHint: ${error.hint}`;
		}
		return output;
	}
	return `Error: ${error instanceof Error ? error.message : String(error)}`;
}

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

	const result = await Result.tryPromise(async () => {
		const proc = spawn(['opencode', 'auth', '--provider', providerId], {
			stdin: 'inherit',
			stdout: 'inherit',
			stderr: 'inherit'
		});

		const exitCode = await proc.exited;
		return exitCode === 0;
	});

	if (Result.isOk(result)) return result.value;

	console.error(
		'Failed to run opencode auth:',
		result.error instanceof Error ? result.error.message : String(result.error)
	);
	console.error('\nMake sure OpenCode CLI is installed: bun add -g opencode-ai');
	return false;
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

	if (
		providerId === 'opencode' ||
		providerId === 'openrouter' ||
		providerId === 'anthropic' ||
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

export const connectCommand = new Command('connect')
	.description('Configure the AI provider and model')
	.option('-g, --global', 'Save to global config instead of project config')
	.option('-p, --provider <id>', 'Provider ID (opencode, openrouter, openai, google, anthropic)')
	.option('-m, --model <id>', 'Model ID (e.g., "claude-haiku-4-5")')
	.action(async (options: { global?: boolean; provider?: string; model?: string }, command) => {
		const globalOpts = command.parent?.opts() as { server?: string; port?: number } | undefined;

		const result = await Result.tryPromise(async () => {
			const server = await ensureServer({
				serverUrl: globalOpts?.server,
				port: globalOpts?.port,
				quiet: true
			});

			const client = createClient(server.url);
			const providers = await getProviders(client);

			// If both provider and model specified via flags, just set them
			if (options.provider && options.model) {
				const result = await updateModel(server.url, options.provider, options.model);
				console.log(`Model updated: ${result.provider}/${result.model}`);

				// Warn if provider not connected
				const info = PROVIDER_INFO[options.provider];
				if (info?.requiresAuth && !providers.connected.includes(options.provider)) {
					console.warn(`\nWarning: Provider "${options.provider}" is not connected.`);
					console.warn('Run "opencode auth" to configure credentials.');
				}

				server.stop();
				return;
			}

			// Interactive mode
			console.log('\n--- Configure AI Provider ---\n');

			const providerOptions: { label: string; value: string }[] = [];

			// Add connected providers first
			for (const connectedId of providers.connected) {
				const info = PROVIDER_INFO[connectedId];
				const label = info
					? `${info.label} ${green('(connected)')}`
					: `${connectedId} ${green('(connected)')}`;
				providerOptions.push({ label, value: connectedId });
			}

			// Add unconnected providers
			for (const p of providers.all) {
				if (!providers.connected.includes(p.id)) {
					const info = PROVIDER_INFO[p.id];
					const label = info ? info.label : p.id;
					providerOptions.push({ label, value: p.id });
				}
			}

			const provider = await promptSelect('Select a provider:', providerOptions);

			// Authenticate if required and not already connected
			const isConnected = providers.connected.includes(provider);
			const info = PROVIDER_INFO[provider];

			if (!isConnected && info?.requiresAuth) {
				console.log(`\nProvider "${provider}" requires authentication.`);
				const guidance = PROVIDER_AUTH_GUIDANCE[provider];
				if (guidance) {
					console.log(`\n${guidance}`);
				}
				const success = await runBtcaAuth(provider);
				if (!success) {
					console.warn('\nAuthentication may have failed. Try again later with: opencode auth');
					server.stop();
					process.exit(1);
				}
			}

			let model: string;
			const curated = CURATED_MODELS[provider] ?? [];

			if (curated.length === 1) {
				model = curated[0]!.id;
				console.log(`\nUsing model: ${curated[0]!.label} (${model})`);
			} else if (curated.length > 1) {
				model = await promptSelect(
					'Select a model:',
					curated.map((m) => ({ label: m.label, value: m.id }))
				);
			} else {
				console.log(`\nCurated models for ${provider} are coming soon.`);
				const rl = createRl();
				model = await promptInput(rl, 'Enter model ID');
				rl.close();

				if (!model) {
					console.error('Error: Model ID is required.');
					server.stop();
					process.exit(1);
				}
			}

			// Update the model
			const result = await updateModel(server.url, provider, model);
			console.log(`\nModel configured: ${result.provider}/${result.model}`);

			// Show where it was saved
			console.log(`\nSaved to: ${options.global ? 'global' : 'project'} config`);

			server.stop();
		});

		if (Result.isError(result)) {
			const error = result.error;
			if (error instanceof Error && error.message === 'Invalid selection') {
				console.error('\nError: Invalid selection. Please try again.');
				process.exit(1);
			}
			if (isPromptCancelled(error)) {
				console.log('\nSelection cancelled.');
				process.exit(0);
			}
			console.error(formatError(error));
			process.exit(1);
		}
	});
