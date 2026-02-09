import { createMemo, type Component } from 'solid-js';
import { CodeRenderable, getTreeSitterClient } from '@opentui/core';

import { normalizeFenceLang } from '../lib/markdown-fence-lang.ts';
import { syntaxStyle } from '../syntax-theme.ts';
import { colors } from '../theme.ts';

export interface MarkdownTextProps {
	content: string;
	streaming?: boolean;
}

export const MarkdownText: Component<MarkdownTextProps> = (props) => {
	const treeSitterClient = createMemo(() => {
		try {
			return getTreeSitterClient();
		} catch {
			return null;
		}
	});

	const content = createMemo(() => normalizeFenceLang(props.content));

	const client = () => treeSitterClient();
	if (!client()) return <text fg={colors.text}>{props.content}</text>;

	return (
		<markdown
			content={content()}
			syntaxStyle={syntaxStyle}
			treeSitterClient={client() ?? undefined}
			conceal
			streaming={Boolean(props.streaming)}
			renderNode={(token, context) => {
				if (token.type !== 'code') return null;

				const r = context.defaultRender();
				if (!r) return r;

				if (r instanceof CodeRenderable) {
					const isStreaming = Boolean(props.streaming);
					r.bg = colors.bg;
					r.paddingLeft = 1;
					r.paddingRight = 1;
					r.wrapMode = 'none';
					r.truncate = false;
					r.streaming = isStreaming;

					// Prevent "unstyled -> styled" flashing on every streaming update.
					// We allow unstyled text for the initial highlight so content is visible immediately,
					// then disable it after the first highlight pass so updates are atomic.
					if (isStreaming) {
						r.onHighlight = (highlights) => {
							if (r.drawUnstyledText) r.drawUnstyledText = false;
							return highlights;
						};
					}
				}

				return r;
			}}
		/>
	);
};
