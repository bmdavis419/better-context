import better_context from '$lib/assets/rules/better_context.mdc?raw';

export const GET = () => {
	return new Response(better_context, {
		headers: {
			'Content-Type': 'text/plain; charset=utf-8'
		}
	});
};
