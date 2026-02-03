import { linearTiming, TransitionSeries } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { AbsoluteFill } from 'remotion';

import { ClipScene } from '../components/ClipScene.tsx';
import { IntroScene } from '../components/IntroScene.tsx';
import { OutroScene } from '../components/OutroScene.tsx';
import type { ClipConfig, LaunchVideoProps } from '../types.ts';

const clip = (overrides: Partial<ClipConfig> & Pick<ClipConfig, 'id'>): ClipConfig => {
	const base = {
		id: overrides.id,
		src: overrides.src ?? 'launch/tui.mov',
		label: overrides.label ?? 'TUI',
		headline: overrides.headline ?? '',
		durationInFrames: overrides.durationInFrames ?? 120
	} satisfies ClipConfig;

	return {
		...base,
		...(overrides.prompt == null ? {} : { prompt: overrides.prompt }),
		...(overrides.trimStartInFrames == null
			? {}
			: { trimStartInFrames: overrides.trimStartInFrames }),
		...(overrides.trimEndInFrames == null ? {} : { trimEndInFrames: overrides.trimEndInFrames })
	};
};

export const launchVideoDefaultProps: LaunchVideoProps = {
	introDurationInFrames: 90, // 3 seconds
	outroDurationInFrames: 90, // 3 seconds
	clips: [
		// Shot 1: TUI - typing in a question (2x speed)
		clip({
			id: 'tui-ask',
			src: 'launch/tui.mov',
			label: 'TUI',
			durationInFrames: 120, // 4 seconds
			trimStartInFrames: 18 * 30,
			trimEndInFrames: 23 * 30,
			playbackRate: 2
		}),
		// Shot 2: TUI - showing the answer
		clip({
			id: 'tui-answer',
			src: 'launch/tui.mov',
			label: 'TUI',
			durationInFrames: 120, // 4 seconds
			trimStartInFrames: 37 * 30,
			trimEndInFrames: 42 * 30
		}),
		// Shot 3: Web - typing in a question
		clip({
			id: 'web-ask',
			src: 'launch/web.mov',
			label: 'Web',
			durationInFrames: 150, // 5 seconds
			trimStartInFrames: 13 * 30,
			trimEndInFrames: 20 * 30
		}),
		// Shot 4: Web - streaming in the answer
		clip({
			id: 'web-answer',
			src: 'launch/web.mov',
			label: 'Web',
			durationInFrames: 150, // 5 seconds
			trimStartInFrames: 21 * 30,
			trimEndInFrames: 30 * 30
		}),
		// Shot 5: CLI - typing in a question
		clip({
			id: 'cli-ask',
			src: 'launch/cli.mov',
			label: 'CLI',
			durationInFrames: 90, // 3 seconds
			trimStartInFrames: 33 * 30,
			trimEndInFrames: 37 * 30
		}),
		// Shot 6: CLI - streaming in the answer
		clip({
			id: 'cli-answer',
			src: 'launch/cli.mov',
			label: 'CLI',
			durationInFrames: 150, // 5 seconds
			trimStartInFrames: 40 * 30,
			trimEndInFrames: 50 * 30
		}),
		// Shot 7: MCP - calling the mcp
		clip({
			id: 'mcp',
			src: 'launch/mcp.mov',
			label: 'MCP',
			durationInFrames: 90, // 3 seconds
			trimStartInFrames: 8 * 30,
			trimEndInFrames: 12 * 30
		})
	],
	transitionDurationInFrames: 8
};

export const LaunchVideo = ({
	clips,
	transitionDurationInFrames,
	introDurationInFrames,
	outroDurationInFrames
}: LaunchVideoProps) => {
	const timing = linearTiming({ durationInFrames: transitionDurationInFrames });

	return (
		<AbsoluteFill style={{ background: '#ffffff' }}>
			<TransitionSeries>
				{/* Intro */}
				<TransitionSeries.Sequence durationInFrames={introDurationInFrames}>
					<IntroScene />
				</TransitionSeries.Sequence>

				<TransitionSeries.Transition presentation={fade()} timing={timing} />

				{/* Clips */}
				{clips.map((c, i) => (
					<>
						<TransitionSeries.Sequence key={c.id} durationInFrames={c.durationInFrames}>
							<ClipScene clip={c} index={i} />
						</TransitionSeries.Sequence>

						{/* Add transition after each clip (including before outro) */}
						{i < clips.length && (
							<TransitionSeries.Transition presentation={fade()} timing={timing} />
						)}
					</>
				))}

				{/* Outro */}
				<TransitionSeries.Sequence durationInFrames={outroDurationInFrames}>
					<OutroScene />
				</TransitionSeries.Sequence>
			</TransitionSeries>
		</AbsoluteFill>
	);
};
