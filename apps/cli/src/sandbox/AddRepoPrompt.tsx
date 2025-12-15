interface Colors {
	bg: string;
	bgSubtle: string;
	bgMuted: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	border: string;
	accent: string;
	info: string;
}

interface AddRepoPromptProps {
	value: string;
	onInput: (value: string) => void;
	onSubmit: () => void;
	colors: Colors;
}

export function AddRepoPrompt({ value, onInput, onSubmit, colors }: AddRepoPromptProps) {
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
				borderColor: colors.info,
				flexDirection: 'column',
				padding: 1
			}}
		>
			<text fg={colors.info} content=" Add Repo" />
			<text fg={colors.textSubtle} content=" Enter repo name or URL, then press Enter" />
			<text content="" style={{ height: 1 }} />
			<box style={{}}>
				<input
					placeholder="repo-name or https://github.com/..."
					placeholderColor={colors.textSubtle}
					textColor={colors.text}
					value={value}
					onInput={onInput}
					onSubmit={onSubmit}
					focused
					style={{ width: '100%' }}
				/>
			</box>
		</box>
	);
}
