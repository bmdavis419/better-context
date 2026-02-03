import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from 'remotion';

const COMMAND = 'bun add -g btca';
const CHAR_FRAMES = 3; // Frames per character
const CURSOR_BLINK_FRAMES = 16;

const Cursor = ({ frame }: { frame: number }) => {
	const opacity = interpolate(
		frame % CURSOR_BLINK_FRAMES,
		[0, CURSOR_BLINK_FRAMES / 2, CURSOR_BLINK_FRAMES],
		[1, 0, 1],
		{ extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
	);

	return (
		<span
			style={{
				opacity,
				backgroundColor: '#a3a3a3',
				width: 14,
				height: 28,
				display: 'inline-block',
				marginLeft: 2,
				verticalAlign: 'middle'
			}}
		/>
	);
};

export const IntroScene = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// Start typing after a brief pause (0.5s)
	const startDelay = Math.round(fps * 0.5);
	const typingFrame = Math.max(0, frame - startDelay);
	const typedChars = Math.min(COMMAND.length, Math.floor(typingFrame / CHAR_FRAMES));
	const typedText = COMMAND.slice(0, typedChars);

	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#ffffff',
				justifyContent: 'center',
				alignItems: 'center'
			}}
		>
			{/* Terminal window */}
			<div
				style={{
					backgroundColor: '#1a1a1a',
					borderRadius: 12,
					padding: 32,
					boxShadow: '0 25px 50px rgba(0, 0, 0, 0.15)',
					minWidth: 600
				}}
			>
				{/* Terminal header dots */}
				<div
					style={{
						display: 'flex',
						gap: 8,
						marginBottom: 24
					}}
				>
					<div
						style={{
							width: 12,
							height: 12,
							borderRadius: '50%',
							backgroundColor: '#ff5f57'
						}}
					/>
					<div
						style={{
							width: 12,
							height: 12,
							borderRadius: '50%',
							backgroundColor: '#febc2e'
						}}
					/>
					<div
						style={{
							width: 12,
							height: 12,
							borderRadius: '50%',
							backgroundColor: '#28c840'
						}}
					/>
				</div>

				{/* Command line */}
				<div
					style={{
						fontFamily: 'SF Mono, Menlo, Monaco, monospace',
						fontSize: 28,
						color: '#e5e5e5',
						display: 'flex',
						alignItems: 'center'
					}}
				>
					<span style={{ color: '#3b82f6', marginRight: 8 }}>$</span>
					<span>{typedText}</span>
					<Cursor frame={frame} />
				</div>
			</div>
		</AbsoluteFill>
	);
};
