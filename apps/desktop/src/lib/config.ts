import { dev } from '$app/environment';
import { env } from '$env/dynamic/public';

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const configuredBackendBaseUrl = trimTrailingSlash(env.PUBLIC_BACKEND_BASE_URL ?? '');
const defaultBackendBaseUrl = dev ? 'http://localhost:5173' : 'https://btca.dev';

export const backendBaseUrl = configuredBackendBaseUrl || defaultBackendBaseUrl;

export const mcpBaseUrl = `${backendBaseUrl}/api/mcp`;
