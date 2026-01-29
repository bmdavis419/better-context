import { Result } from 'better-result';
import { Command } from 'commander';
import * as readline from 'readline';
import { spawn } from 'bun';
import { ensureServer } from '../server/manager.ts';
import { createClient, getProviders, updateModel, BtcaError } from '../client/index.ts';
import { dim, green } from '../lib/utils/colors.ts';

// Recommended models for quick selection
const RECOMMENDED_MODELS = [
	{ provider: 'opencode', model: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (fast, cheap)' },
	{ provider: 'opencode', model: 'claude-sonnet-4', label: 'Claude Sonnet 4 (balanced)' },
	{ provider: 'opencode', model: 'claude-sonnet-4-5', label: 'Claude Sonnet 4.5 (powerful)' },
	{ provider: 'opencode', model: 'gpt-5.1', label: 'GPT 5.1 (balanced)' },
	{ provider: 'opencode', model: 'gpt-5.2', label: 'GPT 5.2 (latest)' },
	{ provider: 'opencode', model: 'gemini-3-flash', label: 'Gemini 3 Flash (fast)' }
];

// Provider display info
const PROVIDER_INFO: Record<string, { label: string; requiresAuth: boolean }> = {
	opencode: { label: 'OpenCode Zen (free tier available)', requiresAuth: false },
	anthropic: { label: 'Anthropic (Claude)', requiresAuth: true },
	openai: { label: 'OpenAI (GPT)', requiresAuth: true },
	google: { label: 'Google (Gemini)', requiresAuth: true },
	'google-vertex': { label: 'Google Vertex AI', requiresAuth: true },
	'amazon-bedrock': { label: 'Amazon Bedrock', requiresAuth: true },
	azure: { label: 'Azure OpenAI', requiresAuth: true },
	groq: { label: 'Groq', requiresAuth: true },
	mistral: { label: 'Mistral', requiresAuth: true },
	xai: { label: 'xAI (Grok)', requiresAuth: true },
	cohere: { label: 'Cohere', requiresAuth: true },
	deepinfra: { label: 'DeepInfra', requiresAuth: true },
	cerebras: { label: 'Cerebras', requiresAuth: true },
	perplexity: { label: 'Perplexity', requiresAuth: true },
	togetherai: { label: 'Together AI', requiresAuth: true }
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

/**
 * Prompt for single selection from a list.
 */
async function promptSelect<T extends string>(
	question: string,
	options: { label: string; value: T }[]
): Promise<T> {
	return new Promise((resolve, reject) => {
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
}

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
	console.error('\nMake sure OpenCode CLI is installed: npm install -g opencode');
	return false;
}

export const connectCommand = new Command('connect')
	.description('Configure the AI provider and model')
	.option('-g, --global', 'Save to global config instead of project config')
	.option('-p, --provider <id>', 'Provider ID (e.g., "opencode", "anthropic")')
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
				if (options.provider !== 'opencode' && !providers.connected.includes(options.provider)) {
					console.warn(`\nWarning: Provider "${options.provider}" is not connected.`);
					console.warn('Run "opencode auth" to configure credentials.');
				}

				server.stop();
				return;
			}

			// Interactive mode
			console.log('\n--- Configure AI Provider ---\n');

			// Step 1: Choose between quick setup or custom
			const setupMode = await promptSelect<'quick' | 'custom'>('How would you like to configure?', [
				{ label: 'Quick setup (recommended models)', value: 'quick' },
				{ label: 'Custom (choose provider and model)', value: 'custom' }
			]);

			let provider: string;
			let model: string;

			if (setupMode === 'quick') {
				// Show recommended models
				const modelChoice = await promptSelect<string>(
					'Select a model:',
					RECOMMENDED_MODELS.map((m) => ({
						label: `${m.label}`,
						value: `${m.provider}:${m.model}`
					}))
				);

				const [p, m] = modelChoice.split(':');
				provider = p!;
				model = m!;
			} else {
				// Custom setup - choose provider first
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

				provider = await promptSelect('Select a provider:', providerOptions);

				// Check if provider needs authentication
				const isConnected = providers.connected.includes(provider);
				const info = PROVIDER_INFO[provider];

				if (!isConnected && info?.requiresAuth) {
					console.log(`\nProvider "${provider}" requires authentication.`);
					const shouldAuth = await promptSelect<'yes' | 'no'>(
						'Would you like to authenticate now?',
						[
							{ label: 'Yes, authenticate now', value: 'yes' },
							{ label: "No, I'll do it later", value: 'no' }
						]
					);

					if (shouldAuth === 'yes') {
						const success = await runOpencodeAuth(provider);
						if (!success) {
							console.warn(
								'\nAuthentication may have failed. You can try again later with: opencode auth'
							);
						}
					} else {
						console.warn(`\nNote: You'll need to authenticate before using this provider.`);
						console.warn('Run: opencode auth --provider ' + provider);
					}
				}

				// Get model from user
				const rl = createRl();

				// Show available models if we know them
				const providerInfo = providers.all.find((p) => p.id === provider);
				if (providerInfo?.models && Object.keys(providerInfo.models).length > 0) {
					const modelIds = Object.keys(providerInfo.models);
					console.log(`\nAvailable models for ${provider}:`);
					modelIds.slice(0, 10).forEach((id) => console.log(`  - ${id}`));
					if (modelIds.length > 10) {
						console.log(`  ... and ${modelIds.length - 10} more`);
					}
				}

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
			console.error(formatError(error));
			process.exit(1);
		}
	});
