import { Composition } from 'remotion';
import { IncidentVideo } from './IncidentVideo.tsx';
import { FPS, HEIGHT, totalFrames, WIDTH, type VideoProps } from './timing.ts';

const placeholder: VideoProps = {
  level: 'layman',
  audioBase: '',
  scenes: [{ id: 'intro', kind: 'intro', heading: 'No incident loaded', narration: 'Render this composition with inputProps from the SIEMVisual server.' }],
  incident: {
    title: 'No incident loaded', summary: '', severity: 'info', startTs: 0, endTs: 1, engine: 'heuristic', assets: [], users: [], events: [],
    stories: {} as VideoProps['incident']['stories'], stats: { records: 0, sources: 0, flagged: 0 },
  },
};

export function Root() {
  return (
    <Composition
      id="IncidentStory"
      component={IncidentVideo}
      width={WIDTH}
      height={HEIGHT}
      fps={FPS}
      durationInFrames={totalFrames(placeholder.scenes)}
      defaultProps={placeholder}
      calculateMetadata={({ props }) => ({ durationInFrames: totalFrames(props.scenes) })}
    />
  );
}
