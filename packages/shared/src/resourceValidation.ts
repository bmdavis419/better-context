export const RESOURCE_NAME_REGEX = /^@?[a-zA-Z0-9][a-zA-Z0-9._-]*(\/[a-zA-Z0-9][a-zA-Z0-9._-]*)*$/;

const RESOURCE_NAME_MAX = 64;

export const getResourceNameError = (name: string) => {
	if (!name || name.trim().length === 0) {
		return 'Resource name cannot be empty';
	}
	if (name.length > RESOURCE_NAME_MAX) {
		return `Resource name too long: ${name.length} chars (max ${RESOURCE_NAME_MAX})`;
	}
	if (!RESOURCE_NAME_REGEX.test(name)) {
		return 'Resource name must start with a letter and contain only letters, numbers, ., _, -, and / (no spaces)';
	}
	if (name.includes('..')) {
		return 'Resource name must not contain ".."';
	}
	if (name.includes('//')) {
		return 'Resource name must not contain "//"';
	}
	if (name.endsWith('/')) {
		return 'Resource name must not end with "/"';
	}

	return null;
};

export const isValidResourceName = (name: string) => getResourceNameError(name) === null;
