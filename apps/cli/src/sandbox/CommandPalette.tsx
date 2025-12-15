import type { Command } from './commands.ts';

interface Colors {
	bg: string;
	bgSubtle: string;
	bgMuted: string;
	text: string;
	textMuted: string;
	textSubtle: string;
	border: string;
	accent: string;
}

interface CommandPaletteProps {
	commands: Command[];
	selectedIndex: number;
	colors: Colors;
}

export function CommandPalette({ commands, selectedIndex, colors }: CommandPaletteProps) {
	if (commands.length === 0) {
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
					borderColor: colors.border,
					padding: 1
				}}
			>
				<text fg={colors.textSubtle} content="No matching commands" />
			</box>
		);
	}

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
				borderColor: colors.accent,
				flexDirection: 'column',
				padding: 1
			}}
		>
			<text fg={colors.textMuted} content=" Commands" />
			<text content="" style={{ height: 1 }} />
			{commands.map((cmd, i) => {
				const isSelected = i === selectedIndex;
				return (
					<box
						key={cmd.name}
						style={{
							flexDirection: 'row'
						}}
					>
						<text
							fg={isSelected ? colors.accent : colors.text}
							content={isSelected ? `▸ /${cmd.name}` : `  /${cmd.name}`}
							style={{ width: 12 }}
						/>
						<text fg={colors.textSubtle} content={` ${cmd.description}`} />
					</box>
				);
			})}
		</box>
	);
}
