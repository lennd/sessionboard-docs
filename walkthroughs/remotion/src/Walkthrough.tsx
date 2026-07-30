import React from 'react';
import {
  AbsoluteFill, Audio, Img, OffthreadVideo, Sequence, Series, interpolate,
  spring, useCurrentFrame, useVideoConfig, staticFile,
} from 'remotion';
import { z } from 'zod';

export const schema = z.object({
  title: z.string(),
  audioSrc: z.string(),
  captureSrc: z.string().nullable(),          // real app-capture .webm, or null -> use step frames
  captions: z.array(z.object({ text: z.string(), startMs: z.number(), endMs: z.number() })),
  steps: z.array(z.object({ caption: z.string(), image: z.string().nullable(), durationInFrames: z.number() })),
});
type Props = z.infer<typeof schema>;

const NAVY = '#0B1B3A', BLUE = '#5B8DEF';
const Logo = () => (
  <div style={{ position: 'absolute', top: 40, left: 56, background: '#fff', padding: '10px 15px',
    borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,.25)' }}>
    <Img src={staticFile('sessionboard.png')} style={{ height: 24, display: 'block' }} />
  </div>
);

const Intro: React.FC<{ title: string }> = ({ title }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const s = spring({ frame: f, fps, config: { damping: 200 } });
  return (
    <AbsoluteFill style={{ background: `linear-gradient(160deg,${NAVY},#122a5c)`, justifyContent: 'center', alignItems: 'center' }}>
      <Logo />
      <div style={{ opacity: s, transform: `translateY(${interpolate(s, [0, 1], [16, 0])}px)`, textAlign: 'center' }}>
        <div style={{ color: BLUE, fontWeight: 800, letterSpacing: 2, fontSize: 24, fontFamily: 'Arial' }}>HELP CENTER · WALKTHROUGH</div>
        <div style={{ color: '#fff', fontWeight: 800, fontSize: 64, fontFamily: 'Arial', marginTop: 10 }}>{title}</div>
      </div>
    </AbsoluteFill>
  );
};

// Ken Burns zoom toward center; for real footage this pans/zooms the captured frame.
const Stage: React.FC<{ src: string | null; isVideo: boolean }> = ({ src, isVideo }) => {
  const f = useCurrentFrame();
  const scale = interpolate(f, [0, 90], [1.0, 1.06], { extrapolateRight: 'clamp' });
  return (
    <AbsoluteFill style={{ background: NAVY, justifyContent: 'center', alignItems: 'center' }}>
      {src && (isVideo
        ? <OffthreadVideo src={src} style={{ width: '100%', transform: `scale(${scale})` }} />
        : <Img src={src} style={{ width: '100%', transform: `scale(${scale})` }} />)}
    </AbsoluteFill>
  );
};

const CaptionBar: React.FC<{ captions: Props['captions'] }> = ({ captions }) => {
  const f = useCurrentFrame(); const { fps } = useVideoConfig();
  const ms = (f / fps) * 1000;
  const cur = captions.find(c => ms >= c.startMs && ms <= c.endMs);
  if (!cur) return null;
  return (
    <AbsoluteFill style={{ justifyContent: 'flex-end', alignItems: 'center', paddingBottom: 48 }}>
      <div style={{ background: 'rgba(11,27,58,.82)', color: '#fff', fontFamily: 'Arial', fontSize: 26,
        fontWeight: 600, padding: '12px 22px', borderRadius: 12, maxWidth: 1040, textAlign: 'center' }}>
        {cur.text}
      </div>
    </AbsoluteFill>
  );
};

export const Walkthrough: React.FC<Props> = ({ title, audioSrc, captureSrc, captions, steps }) => {
  const { fps } = useVideoConfig();
  const intro = Math.round(2 * fps);
  return (
    <AbsoluteFill style={{ background: NAVY }}>
      <Series>
        <Series.Sequence durationInFrames={intro}><Intro title={title} /></Series.Sequence>
        <Series.Sequence durationInFrames={steps.reduce((a, s) => a + s.durationInFrames, 1)}>
          {/* real footage plays across all steps; slide frames swap per step */}
          {captureSrc
            ? <Stage src={captureSrc} isVideo />
            : <Series>
                {steps.map((st, i) => (
                  <Series.Sequence key={i} durationInFrames={st.durationInFrames}>
                    <Stage src={st.image} isVideo={false} />
                  </Series.Sequence>
                ))}
              </Series>}
          <Logo />
        </Series.Sequence>
      </Series>
      {/* captions run on the global timeline (already offset past the intro) */}
      <Sequence from={0}><CaptionBar captions={captions} /></Sequence>
      <Audio src={audioSrc} startFrom={0} />
    </AbsoluteFill>
  );
};
