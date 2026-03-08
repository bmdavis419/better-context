export type McpVisibleResource = {
	name: string;
	displayName: string;
	type: 'git' | 'npm';
	url?: string;
	branch?: string;
	package?: string;
	version?: string;
	searchPath?: string;
	specialNotes?: string;
	isGlobal: false;
};

type McpNamedResources = {
	global: Array<{ name: string }>;
	custom: Array<{ name: string }>;
};

type McpCustomResource = {
	name: string;
	displayName: string;
	type: 'git' | 'npm';
	url?: string;
	branch?: string;
	package?: string;
	version?: string;
	searchPath?: string;
	specialNotes?: string;
	isGlobal: false;
};

export const getAvailableMcpResourceNames = ({ global, custom }: McpNamedResources) => [
	...global.map(({ name }) => name),
	...custom.map(({ name }) => name)
];

export const toMcpVisibleResources = (resources: McpCustomResource[]): McpVisibleResource[] =>
	resources.reduce<McpVisibleResource[]>((visible, resource) => {
		if (resource.type === 'git') {
			if (!resource.url || !resource.branch) return visible;
			visible.push({
				name: resource.name,
				displayName: resource.displayName,
				type: 'git',
				url: resource.url,
				branch: resource.branch,
				searchPath: resource.searchPath,
				specialNotes: resource.specialNotes,
				isGlobal: false
			});
			return visible;
		}

		if (!resource.package) return visible;
		visible.push({
			name: resource.name,
			displayName: resource.displayName,
			type: 'npm',
			package: resource.package,
			version: resource.version,
			specialNotes: resource.specialNotes,
			isGlobal: false
		});
		return visible;
	}, []);
