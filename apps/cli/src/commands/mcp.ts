import { Command } from 'commander';
import { bold, dim, red } from '../lib/utils/colors.ts';

type McpAgent = 'opencode' | 'claude' | 'cursor';

type McpConfig =
	| {
			mcpServers: Record<
				string,
				{
					url: string;
					headers?: Record<string, string>;
				}
			>;
	  }
	| string;

function getMcpConfig(agent: McpAgent, url: string, token?: string): McpConfig {
	const headers = token ? { Authorization: `Bearer ${token}` } : undefined;

	switch (agent) {
		case 'claude': {
			// Claude Code supports adding MCP servers via CLI.
			// (User can also copy/paste JSON manually depending on their setup.)
			const headerArgs = token ? ` --header "Authorization: Bearer ${token}"` : '';
			return `claude mcp add better-context --url ${url}${headerArgs}`;
		}
		case 'cursor': {
			return {
				mcpServers: {
					'better-context': {
						url,
						...(headers ? { headers } : {})
					}
				}
			};
		}
		case 'opencode': {
			return {
				mcpServers: {
					'better-context': {
						url,
						...(headers ? { headers } : {})
					}
				}
			};
		}
	}
}

function getMcpInstructions(agent: McpAgent): string {
	switch (agent) {
		case 'opencode':
			return `Add this to your ${bold('opencode.json')} file:`;
		case 'claude':
			return `Run this command to add the MCP server:`;
		case 'cursor':
			return `Add this to your ${bold('.cursor/mcp.json')} file:`;
	}
}

export const mcpCommand = new Command('mcp')
	.description('Output MCP configuration for local btca server (MCP over HTTP)')
	.argument('[agent]', 'Agent type: opencode, claude, or cursor')
	.option('-p, --port <port>', 'Local btca server port (default: 8080)', '8080')
	.option('--token <token>', 'Optional bearer token required by the MCP endpoint')
	.action(async (agent?: string, options?: { port?: string; token?: string }) => {
		const port = options?.port ? parseInt(options.port, 10) : 8080;
		const token = options?.token;

		let selectedAgent: McpAgent;
		if (agent) {
			const normalized = agent.toLowerCase();
			if (normalized !== 'opencode' && normalized !== 'claude' && normalized !== 'cursor') {
				console.error(red(`Invalid agent: ${agent}`));
				console.error('Valid options: opencode, claude, cursor');
				process.exit(1);
			}
			selectedAgent = normalized as McpAgent;
		} else {
			// Default to Cursor since it's a common MCP consumer.
			selectedAgent = 'cursor';
		}

		const url = `http://localhost:${port}/mcp`;
		const config = getMcpConfig(selectedAgent, url, token);
		const instructions = getMcpInstructions(selectedAgent);

		console.log(`\n${dim('Local MCP server:')} ${bold(url)}`);
		console.log(`${dim('Make sure the server is running with:')} ${bold('btca serve --mcp')}`);
		if (token) {
			console.log(`${dim('Token auth enabled (Authorization: Bearer …)')}`);
		}

		console.log(`\n${instructions}\n`);
		if (typeof config === 'string') {
			console.log(config);
		} else {
			console.log(JSON.stringify(config, null, 2));
		}
		console.log('');
	});
