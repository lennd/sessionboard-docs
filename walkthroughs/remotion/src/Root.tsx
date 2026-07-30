import { Composition, staticFile } from 'remotion';
import { Walkthrough, schema } from './Walkthrough';

// Props are provided at render time via --props=props.json (written by generate.mjs).
// durationInFrames is computed from the narration length in generate.mjs and passed in.
export const RemotionRoot: React.FC = () => (
  <Composition
    id="Walkthrough"
    component={Walkthrough}
    durationInFrames={900}
    fps={30}
    width={1280}
    height={720}
    schema={schema}
    defaultProps={{
      title: 'Create a session',
      audioSrc: staticFile('narration.m4a'),
      captureSrc: null,
      captions: [],
      steps: [],
    }}
  />
);
