import { AbsoluteFill, interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';

export const OutroScene = () => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	// Fade in with spring
	const entrance = spring({
		frame,
		fps,
		config: { damping: 200 }
	});

	const opacity = interpolate(entrance, [0, 1], [0, 1]);
	const scale = interpolate(entrance, [0, 1], [0.95, 1]);

	return (
		<AbsoluteFill
			style={{
				backgroundColor: '#ffffff',
				justifyContent: 'center',
				alignItems: 'center'
			}}
		>
			<div
				style={{
					fontFamily: 'SF Mono, Menlo, Monaco, monospace',
					fontSize: 72,
					fontWeight: 600,
					color: '#1a1a1a',
					opacity,
					transform: `scale(${scale})`
				}}
			>
				btca.dev
			</div>
		</AbsoluteFill>
	);
};
