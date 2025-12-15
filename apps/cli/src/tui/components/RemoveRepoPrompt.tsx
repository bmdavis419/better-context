import type { Colors } from '../theme.ts';

interface RemoveRepoPromptProps {
	repoName: string;
	colors: Colors;
}

export function RemoveRepoPrompt({ repoName, colors }: RemoveRepoPromptProps) {
	return (
		<box
			style={{
				position: 'absolute',
				bottom: 4,
				left: 0,
				width: '100%',
				zIndex: 100,
				backgroundColor: colors.bgSubtle,
				border: true,
				borderColor: colors.error,
				flexDirection: 'column',
				padding: 1
			}}
		>
			<text fg={colors.error} content=" Remove Repo" />
			<text content="" style={{ height: 1 }} />
			<text fg={colors.text}>
				{`Are you sure you want to remove "`}
				<span fg={colors.accent}>{repoName}</span>
				{`" from your configuration?`}
			</text>
			<text content="" style={{ height: 1 }} />
			<box style={{ flexDirection: 'row' }}>
				<text fg={colors.success} content=" [Y] Yes, remove" />
				<text fg={colors.textSubtle} content="  " />
				<text fg={colors.textMuted} content="[N/Esc] Cancel" />
			</box>
		</box>
	);
}
