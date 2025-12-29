import { createResource, For, Show, type Component } from 'solid-js';
import { renderMarkdownToChunks, type StyledChunk } from '../lib/markdown-renderer.ts';
import { colors } from '../theme.ts';
import { TextAttributes } from '@opentui/core';

export interface MarkdownTextProps {
	content: string;
}

// Convert our style flags to TextAttributes
function getTextAttributes(chunk: StyledChunk): number {
	let attrs = 0;
	if (chunk.bold) attrs |= TextAttributes.BOLD;
	if (chunk.italic) attrs |= TextAttributes.ITALIC;
	if (chunk.underline) attrs |= TextAttributes.UNDERLINE;
	return attrs;
}

export const MarkdownText: Component<MarkdownTextProps> = (props) => {
	const [chunks] = createResource(
		() => props.content,
		async (content) => {
			try {
				return await renderMarkdownToChunks(content, {
					colors: {
						accent: colors.accent,
						text: colors.text,
						textMuted: colors.textMuted,
						textSubtle: colors.textSubtle,
						success: colors.success,
						info: colors.info,
						error: colors.error
					}
				});
			} catch (error) {
				// Fallback to plain text on error
				return null;
			}
		}
	);

	return (
		<Show when={chunks()} fallback={<text fg={colors.text}>{props.content}</text>}>
			{(styledChunks: () => StyledChunk[]) => (
				<text>
					<For each={styledChunks()}>
						{(chunk) => {
							const attrs = getTextAttributes(chunk);
							return (
								<span
									style={{
										fg: chunk.fg || colors.text,
										attributes: attrs > 0 ? attrs : undefined
									}}
								>
									{chunk.text}
								</span>
							);
						}}
					</For>
				</text>
			)}
		</Show>
	);
};
