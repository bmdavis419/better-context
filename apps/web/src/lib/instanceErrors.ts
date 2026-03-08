export type InstanceErrorKind = 'disk_full' | 'generic';

export const INSTANCE_DISK_FULL_MESSAGE = 'Your instance cache is full. Reset it to continue.';
export const INSTANCE_DISK_FULL_APP_MESSAGE =
	'Your instance cache is full. Reset it in the web app to continue.';

const diskFullPatterns = [
	/enospc/i,
	/no space left on device/i,
	/disk quota exceeded/i,
	/quota exceeded/i
];

const collectErrorParts = (value: unknown, seen = new Set<unknown>()): string[] => {
	if (value == null || seen.has(value)) return [];

	if (typeof value === 'string') {
		return [value];
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return [String(value)];
	}

	if (typeof value !== 'object') {
		return [];
	}

	seen.add(value);

	if (value instanceof Error) {
		return [
			value.message,
			value.stack ?? '',
			...collectErrorParts((value as Error & { cause?: unknown }).cause, seen)
		];
	}

	const record = value as Record<string, unknown>;
	const parts = Object.values(record).flatMap((entry) => collectErrorParts(entry, seen));

	try {
		parts.push(JSON.stringify(record));
	} catch {
		// Ignore circular or non-serializable values.
	}

	return parts;
};

export const getInstanceErrorKind = (value: unknown): InstanceErrorKind => {
	const haystack = collectErrorParts(value).join('\n');
	return diskFullPatterns.some((pattern) => pattern.test(haystack)) ? 'disk_full' : 'generic';
};

export const isDiskFullError = (value: unknown) => getInstanceErrorKind(value) === 'disk_full';

export const getUserFacingInstanceError = (value: unknown, fallback: string) =>
	getInstanceErrorKind(value) === 'disk_full' ? INSTANCE_DISK_FULL_MESSAGE : fallback;
