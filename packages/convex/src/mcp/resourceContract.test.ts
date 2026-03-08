import { describe, expect, test } from 'bun:test';

import { getAvailableMcpResourceNames, toMcpVisibleResources } from './resourceContract.ts';

describe('mcp resource contract', () => {
	test('exposes git and npm resources in list responses', () => {
		expect(
			toMcpVisibleResources([
				{
					name: 'react-docs',
					displayName: 'react-docs',
					type: 'git',
					url: 'https://github.com/facebook/react',
					branch: 'main',
					searchPath: 'docs',
					specialNotes: 'git docs',
					isGlobal: false
				},
				{
					name: 'react',
					displayName: 'react',
					type: 'npm',
					package: 'react',
					version: '19.0.0',
					specialNotes: 'npm package',
					isGlobal: false
				}
			])
		).toEqual([
			{
				name: 'react-docs',
				displayName: 'react-docs',
				type: 'git',
				url: 'https://github.com/facebook/react',
				branch: 'main',
				searchPath: 'docs',
				specialNotes: 'git docs',
				isGlobal: false
			},
			{
				name: 'react',
				displayName: 'react',
				type: 'npm',
				package: 'react',
				version: '19.0.0',
				specialNotes: 'npm package',
				isGlobal: false
			}
		]);
	});

	test('keeps npm and git names available for ask validation', () => {
		expect(
			getAvailableMcpResourceNames({
				global: [{ name: 'nextjs' }],
				custom: [{ name: 'react-docs' }, { name: 'react' }]
			})
		).toEqual(['nextjs', 'react-docs', 'react']);
	});
});
