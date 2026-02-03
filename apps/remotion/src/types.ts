export type ClipConfig = {
	id: string;
	src: string;
	label: string;
	headline: string;
	prompt?: string;
	durationInFrames: number;
	trimStartInFrames?: number;
	trimEndInFrames?: number;
	playbackRate?: number;
};

export type LaunchVideoProps = {
	clips: ClipConfig[];
	introDurationInFrames: number;
	outroDurationInFrames: number;
	transitionDurationInFrames: number;
};
