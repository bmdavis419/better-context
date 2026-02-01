import { Daytona, Image } from '@daytonaio/sdk';
import { BTCA_SNAPSHOT_NAME } from './shared.ts';

async function main(): Promise<void> {
	if (!process.env.DAYTONA_API_KEY) {
		console.error('Missing DAYTONA_API_KEY environment variable');
		process.exit(1);
	}

	console.log('Initializing Daytona SDK...');
	const daytona = new Daytona();

	// Create the image with nvm, node, bun, btca, and opencode pre-installed
	const image = Image.base('debian:12')
		.runCommands(
			'apt-get update',
			'apt-get install -y curl unzip git ca-certificates bash',
			// Install nvm and Node.js 24 (required for opencode-ai)
			'curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash',
			'bash -c "source /root/.nvm/nvm.sh && nvm install 24"',
			// Install bun
			'curl -fsSL https://bun.sh/install | bash',
			// Install global packages
			'/root/.bun/bin/bun add -g btca'
		)
		.env({
			PATH: '/root/.nvm/versions/node/v24.13.0/bin:/root/.bun/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
			BUN_INSTALL: '/root/.bun',
			NVM_DIR: '/root/.nvm',
			SHELL: '/bin/bash'
		});

	console.log(`Creating snapshot: ${BTCA_SNAPSHOT_NAME}`);
	console.log('This may take a few minutes...\n');

	const snapshot = await daytona.snapshot.create(
		{
			name: BTCA_SNAPSHOT_NAME,
			image,
			resources: {
				cpu: 2,
				memory: 4,
				disk: 5
			}
		},
		{ onLogs: (log) => console.log('[snapshot]', log) }
	);

	console.log('\nSnapshot created successfully!');
	console.log(`Name: ${snapshot.name}`);
	console.log(`State: ${snapshot.state}`);
	console.log('\nRun sandboxes with: bun sandbox');
}

// Only run when executed directly, not when imported
if (import.meta.main) {
	main().catch((error) => {
		console.error('Error:', error);
		process.exit(1);
	});
}
