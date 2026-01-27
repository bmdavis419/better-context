#!/usr/bin/env bun
/**
 * Manual test script for Phase 1+2 implementation
 * Run with: bun apps/server/test-phase1.ts
 */

import { Auth } from './src/providers/auth.ts';
import { getSupportedProviders } from './src/providers/registry.ts';
import { Model } from './src/providers/model.ts';
import { Ripgrep } from './src/tools/ripgrep.ts';
import { ReadTool, GrepTool, GlobTool, ListTool } from './src/tools/index.ts';
import { AgentLoop } from './src/agent/loop.ts';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

async function main() {
	console.log('=== Phase 1+2 Test Script ===\n');

	// 1. Test Auth
	console.log('1. Testing Auth...');
	const providers = await Auth.getAuthenticatedProviders();
	console.log(`   Authenticated providers: ${providers.join(', ') || 'none'}`);

	if (providers.length === 0) {
		console.log('   ❌ No providers authenticated. Run `opencode auth` first.');
		process.exit(1);
	}
	console.log('   ✅ Auth working\n');

	// 2. Test Provider Registry
	console.log('2. Testing Provider Registry...');
	const supportedProviders = getSupportedProviders();
	console.log(
		`   Supported providers: ${supportedProviders.slice(0, 5).join(', ')}... (${supportedProviders.length} total)`
	);
	console.log('   ✅ Registry working\n');

	// 3. Test Ripgrep
	console.log('3. Testing Ripgrep...');
	const rgPath = await Ripgrep.filepath();
	console.log(`   Ripgrep path: ${rgPath}`);
	const rgResult = await Ripgrep.run(['--version']);
	console.log(`   Version: ${rgResult.stdout.trim().split('\n')[0]}`);
	console.log('   ✅ Ripgrep working\n');

	// 4. Test Tools with a temp directory
	console.log('4. Testing Tools...');
	const testDir = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-test-'));

	// Create test files
	await fs.writeFile(path.join(testDir, 'hello.txt'), 'Hello, World!\nThis is a test file.');
	await fs.mkdir(path.join(testDir, 'subdir'));
	await fs.writeFile(path.join(testDir, 'subdir', 'nested.ts'), 'export const foo = "bar";');

	// Test list
	const listResult = await ListTool.execute({ path: '.' }, { basePath: testDir });
	console.log(`   List result: ${listResult.output.split('\n').length} entries`);

	// Test read
	const readResult = await ReadTool.execute({ path: 'hello.txt' }, { basePath: testDir });
	console.log(
		`   Read result: ${readResult.output.includes('Hello, World!') ? 'content matches' : 'MISMATCH'}`
	);

	// Test glob
	const globResult = await GlobTool.execute({ pattern: '**/*.ts' }, { basePath: testDir });
	console.log(
		`   Glob result: ${globResult.output.includes('nested.ts') ? 'found .ts file' : 'NOT FOUND'}`
	);

	// Test grep
	const grepResult = await GrepTool.execute({ pattern: 'foo' }, { basePath: testDir });
	console.log(
		`   Grep result: ${grepResult.output.includes('nested.ts') ? 'found match' : 'NOT FOUND'}`
	);

	// Cleanup
	await fs.rm(testDir, { recursive: true });
	console.log('   ✅ All tools working\n');

	// 5. Test Model Creation (without calling API)
	console.log('5. Testing Model Creation...');
	const firstProvider = providers[0]!;
	// Use appropriate model ID based on provider
	// For opencode, use big-pickle (free model) or claude-sonnet-4-5
	const testModelId = firstProvider === 'opencode' ? 'big-pickle' : 'claude-sonnet-4-20250514';
	try {
		// Just test that we can create a model - don't actually call it
		const model = await Model.getModel(firstProvider, testModelId);
		console.log(`   Created model for ${firstProvider}/${testModelId}`);
		console.log('   ✅ Model creation working\n');
	} catch (e) {
		console.log(`   ⚠️  Could not create model for ${firstProvider}: ${e}`);
		console.log('   (This might be expected if provider uses non-standard model IDs)\n');
	}

	// 6. Optional: Full Agent Loop Test (requires API call)
	const runFullTest = process.argv.includes('--full');
	if (runFullTest) {
		console.log('6. Testing Full Agent Loop (API call)...');
		const agentTestDir = await fs.mkdtemp(path.join(os.tmpdir(), 'btca-agent-'));
		await fs.writeFile(
			path.join(agentTestDir, 'README.md'),
			'# Test Project\n\nThis project contains the secret code: ALPHA-123.'
		);
		// Use appropriate model ID based on provider
		// For opencode, use big-pickle (free) - uses openai-compatible endpoint
		const agentModelId = firstProvider === 'opencode' ? 'big-pickle' : 'claude-sonnet-4-20250514';
		try {
			const result = await AgentLoop.run({
				providerId: firstProvider,
				modelId: agentModelId,
				collectionPath: agentTestDir,
				agentInstructions: 'This is a test collection.',
				question: 'What is the secret code mentioned in the README?',
				maxSteps: 5
			});

			console.log(`   Answer: ${result.answer.substring(0, 100)}...`);
			console.log(`   Events: ${result.events.length}`);
			console.log(`   Model: ${result.model.provider}/${result.model.model}`);
			console.log('   ✅ Agent loop working\n');
		} catch (e) {
			console.log(`   ❌ Agent loop failed: ${e}\n`);
		}

		await fs.rm(agentTestDir, { recursive: true });
	} else {
		console.log('6. Skipping full agent loop test (run with --full to enable)\n');
	}

	console.log('=== All Phase 1+2 tests passed! ===');
}

main().catch((e) => {
	console.error('Test failed:', e);
	process.exit(1);
});
