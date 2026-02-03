import {
	AbsoluteFill,
	interpolate,
	OffthreadVideo,
	staticFile,
	useCurrentFrame,
	useVideoConfig
} from 'remotion';

import type { ClipConfig } from '../types.ts';

type ClipSceneProps = {
	clip: ClipConfig;
	index: number;
};

// Different motion patterns for variety
const motionPatterns = [
	// Pattern 0: Drift left and down, slight tilt right
	{ translateX: [0, -15], translateY: [0, 10], rotateX: [4, 3], rotateY: [-2, -1] },
	// Pattern 1: Drift right and up, slight tilt left
	{ translateX: [0, 15], translateY: [0, -8], rotateX: [3, 4], rotateY: [2, 1] },
	// Pattern 2: Drift left and up, tilt forward
	{ translateX: [0, -12], translateY: [0, -10], rotateX: [2, 4], rotateY: [-1, -2] },
	// Pattern 3: Drift right and down, tilt back
	{ translateX: [0, 10], translateY: [0, 12], rotateX: [5, 3], rotateY: [1, 2] },
	// Pattern 4: Minimal horizontal, drift up, subtle rotation
	{ translateX: [0, -5], translateY: [0, -15], rotateX: [3, 2], rotateY: [-2, 0] },
	// Pattern 5: Drift down-left, rotate outward
	{ translateX: [0, -18], translateY: [0, 8], rotateX: [4, 5], rotateY: [0, -2] },
	// Pattern 6: Drift up-right, settle flat
	{ translateX: [0, 12], translateY: [0, -6], rotateX: [5, 3], rotateY: [-1, 1] }
];

export const ClipScene = ({ clip, index }: ClipSceneProps) => {
	const frame = useCurrentFrame();
	const { durationInFrames } = useVideoConfig();

	const pattern = motionPatterns[index % motionPatterns.length]!;

	const translateX = interpolate(frame, [0, durationInFrames], pattern.translateX, {
		extrapolateRight: 'clamp'
	});
	const translateY = interpolate(frame, [0, durationInFrames], pattern.translateY, {
		extrapolateRight: 'clamp'
	});
	const rotateX = interpolate(frame, [0, durationInFrames], pattern.rotateX, {
		extrapolateRight: 'clamp'
	});
	const rotateY = interpolate(frame, [0, durationInFrames], pattern.rotateY, {
		extrapolateRight: 'clamp'
	});

	return (
		<AbsoluteFill style={{ backgroundColor: '#ffffff' }}>
			<AbsoluteFill
				style={{
					perspective: 1400,
					perspectiveOrigin: '50% 50%'
				}}
			>
				<div
					style={{
						position: 'absolute',
						left: '5%',
						top: '5%',
						width: '90%',
						height: '90%',
						transform: `translateX(${translateX}px) translateY(${translateY}px) rotateX(${rotateX}deg) rotateY(${rotateY}deg)`,
						transformOrigin: '50% 50%',
						borderRadius: 12,
						overflow: 'hidden',
						boxShadow: '0 25px 50px rgba(0, 0, 0, 0.15), 0 10px 20px rgba(0, 0, 0, 0.1)'
					}}
				>
					<OffthreadVideo
						src={staticFile(clip.src)}
						startFrom={clip.trimStartInFrames}
						endAt={clip.trimEndInFrames}
						playbackRate={clip.playbackRate ?? 1}
						style={{
							width: '100%',
							height: '100%',
							objectFit: 'cover'
						}}
						muted
					/>
				</div>
			</AbsoluteFill>
		</AbsoluteFill>
	);
};
