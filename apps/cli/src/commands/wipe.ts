import { Result } from 'better-result';
import { Command } from 'commander';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import * as readline from 'readline';
import { bold, dim, red, yellow } from '../lib/utils/colors.ts';

const home = path.resolve(os.homedir());
const configFilenames = ['btca.config.jsonc'];
const globalConfigDir = path.join(home, '.config', 'btca');

const createRl = () =>
	readline.createInterface({
		input: process.stdin,
		output: process.stdout
	});

const promptInput = (rl: readline.Interface, question: string) =>
	new Promise<string>((resolve) => {
		rl.question(question, (answer) => resolve(answer.trim()));
	});

const listTargets = () => {
	const cwd = process.cwd();
	const targets = new Map<string, string>();

	for (const name of configFilenames) {
		targets.set(path.resolve(cwd, name), 'project config');
		targets.set(path.resolve(globalConfigDir, name), 'global config');
	}

	return [...targets.entries()].map(([target, source]) => ({ target, source }));
};

const removeTarget = async (target: string) => {
	const exists = await Bun.file(target).exists();
	if (!exists) return { kind: 'missing' as const, target };

	try {
		await fs.rm(target, { force: true });
		return { kind: 'removed' as const, target };
	} catch (error) {
		return {
			kind: 'failed' as const,
			target,
			error: error instanceof Error ? error.message : String(error)
		};
	}
};

const confirmWipe = async (targets: { target: string; source: string }[]) => {
	if (!process.stdin.isTTY || !process.stdout.isTTY) {
		console.error('Refusing to run wipe in non-interactive mode without --yes.');
		process.exit(1);
	}

	console.log(red('\nWARNING: this will permanently delete BTCA config files.'));
	console.log(yellow('Only current-directory and global BTCA config files will be removed.'));
	console.log('\nTargets:');
	for (const { target, source } of targets) {
		console.log(`- ${target} ${dim(`(${source})`)}`);
	}
	console.log('');

	const rl = createRl();
	try {
		const answer = await promptInput(rl, `Type ${bold('WIPE')} to continue: `);
		if (answer !== 'WIPE') {
			console.log('Cancelled.');
			process.exit(0);
		}
	} finally {
		rl.close();
	}
};

const runWipe = async () => {
	const targets = listTargets();
	const removed: string[] = [];
	const missing: string[] = [];
	const failed: string[] = [];

	for (const { target, source } of targets) {
		const result = await removeTarget(target);
		if (result.kind === 'removed') {
			removed.push(`${result.target} (${source})`);
			continue;
		}
		if (result.kind === 'missing') {
			missing.push(`${result.target} (${source})`);
			continue;
		}
		failed.push(`${result.target} (${source}) -> ${result.error}`);
	}

	return { targets, removed, missing, failed };
};

const printReport = (result: Awaited<ReturnType<typeof runWipe>>) => {
	console.log('\nBTCA wipe complete.');
	console.log(`Directory: ${process.cwd()}`);
	console.log(`Targets: ${result.targets.length}`);
	console.log(`Removed: ${result.removed.length}`);
	console.log(`Missing: ${result.missing.length}`);
	console.log(`Failed: ${result.failed.length}`);

	if (result.removed.length) {
		console.log('\nRemoved paths:');
		for (const line of result.removed) console.log(`- ${line}`);
	}

	if (result.missing.length) {
		console.log('\nNot found:');
		for (const line of result.missing) console.log(`- ${line}`);
	}

	if (result.failed.length) {
		console.log('\nFailed removals:');
		for (const line of result.failed) console.log(`- ${line}`);
	}
};

export const wipeCommand = new Command('wipe')
	.description('Delete BTCA config files in the current directory and global config directory')
	.option('-y, --yes', 'Skip confirmation prompt')
	.action(async (options: { yes?: boolean }) => {
		const result = await Result.tryPromise(async () => {
			const targets = listTargets();
			if (!options.yes) {
				await confirmWipe(targets);
			}

			const wipeResult = await runWipe();
			printReport(wipeResult);
			if (wipeResult.failed.length > 0) process.exitCode = 1;
		});

		if (Result.isError(result)) {
			console.error(
				`Error: ${result.error instanceof Error ? result.error.message : String(result.error)}`
			);
			process.exit(1);
		}
	});
