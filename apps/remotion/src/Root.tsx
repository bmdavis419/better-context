import type { CalculateMetadataFunction } from 'remotion';
import { Composition, Folder } from 'remotion';

import { LaunchVideo, launchVideoDefaultProps } from './compositions/LaunchVideo.tsx';
import type { LaunchVideoProps } from './types.ts';

const calculateMetadata: CalculateMetadataFunction<LaunchVideoProps> = ({ props }) => {
	// Total transitions: intro->clip1, clip1->clip2, ..., clipN->outro
	const numTransitions = props.clips.length + 1;

	const clipsTotal = props.clips.reduce((sum, clip) => sum + clip.durationInFrames, 0);
	const total =
		props.introDurationInFrames +
		clipsTotal +
		props.outroDurationInFrames -
		numTransitions * props.transitionDurationInFrames;

	return {
		durationInFrames: Math.max(total, 1),
		props
	};
};

export const RemotionRoot = () => {
	return (
		<Folder name="Launch">
			<Composition
				id="btca-launch"
				component={LaunchVideo}
				durationInFrames={900}
				fps={30}
				width={1920}
				height={1080}
				defaultProps={
					{
						...launchVideoDefaultProps
					} satisfies LaunchVideoProps
				}
				calculateMetadata={calculateMetadata}
			/>
		</Folder>
	);
};
