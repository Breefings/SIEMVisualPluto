import { Player, type PlayerRef } from '@remotion/player';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CaseSummary, Level, Scene, Status } from '../../shared/types.ts';
import { LEVELS } from '../../shared/types.ts';
import { Icon } from '../../shared/Icon.tsx';
import { fmtClock, PHASE_COLOR } from '../../shared/theme.ts';
import { IncidentVideo } from '../../video/IncidentVideo.tsx';
import { FPS, HEIGHT, timeline, totalFrames, WIDTH, type VideoProps } from '../../video/timing.ts';
import { api, type RenderJob } from '../api.ts';

export function VideoView({ c, level, status }: { c: CaseSummary; level: Level; status: Status | null }) {
  const inc = c.incident!;
  const [scenes, setScenes] = useState<Scene[] | null>(null);
  const [err, setErr] = useState('');
  const [evidence, setEvidence] = useState<Record<string, string[]>>({});
  const [job, setJob] = useState<RenderJob | null>(null);
  const [frame, setFrame] = useState(0);
  const player = useRef<PlayerRef>(null);

  // narration (Piper TTS, cached server-side)
  useEffect(() => {
    let live = true;
    setScenes(null);
    setErr('');
    api.narrate(c.id, level).then((r) => live && setScenes(r.scenes)).catch((e) => {
      if (!live) return;
      setErr(String(e.message));
      setScenes(inc.stories[level].scenes);
    });
    api.renderStatus(c.id, level).then((j) => live && setJob(j.state === 'none' ? null : j)).catch(() => {});
    return () => { live = false; };
  }, [c.id, level, inc]);

  // evidence lines for the senior terminal
  useEffect(() => {
    const ids = [...new Set(inc.events.flatMap((e) => e.evidence.slice(0, 3)))];
    if (!ids.length) return;
    api.records(c.id, { ids, limit: 2000 }).then(({ records }) => {
      const byId = new Map(records.map((r) => [r.id, r.raw]));
      setEvidence(Object.fromEntries(inc.events.map((e) => [e.id, e.evidence.slice(0, 3).map((id) => byId.get(id)).filter(Boolean) as string[]])));
    }).catch(() => {});
  }, [c.id, inc]);

  // poll render job
  useEffect(() => {
    if (job?.state !== 'running') return;
    const t = setInterval(() => api.renderStatus(c.id, level).then(setJob).catch(() => {}), 1000);
    return () => clearInterval(t);
  }, [job?.state, c.id, level]);

  useEffect(() => {
    const p = player.current;
    if (!p) return;
    const on = (e: { detail: { frame: number } }) => setFrame(e.detail.frame);
    p.addEventListener('frameupdate', on);
    return () => p.removeEventListener('frameupdate', on);
  }, [scenes]);

  const props: VideoProps | null = useMemo(() => (scenes ? { incident: inc, level, scenes, audioBase: '', evidence } : null), [scenes, inc, level, evidence]);
  const tl = useMemo(() => (scenes ? timeline(scenes) : []), [scenes]);
  const evById = new Map(inc.events.map((e) => [e.id, e]));
  const L = LEVELS.find((l) => l.id === level)!;

  const transcript = () => {
    const text = [inc.stories[level].title, '', ...(scenes ?? []).map((s) => `## ${s.heading}\n${s.narration}`)].join('\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
    a.download = `${c.id}-${level}-transcript.txt`;
    a.click();
  };

  return (
    <div className="video-wrap">
      <div className="video-main card">
        {!props ? (
          <div className="video-loading">
            <div className="spinner" />
            <div>Generating narration with Piper TTS for the <b>{L.label}</b> story…</div>
            <div className="muted small">Open-source neural voice, running locally. Cached after the first run.</div>
          </div>
        ) : (
          <Player
            ref={player}
            component={IncidentVideo}
            inputProps={props}
            durationInFrames={totalFrames(props.scenes)}
            fps={FPS}
            compositionWidth={WIDTH}
            compositionHeight={HEIGHT}
            style={{ width: '100%', aspectRatio: '16 / 9', borderRadius: 12, overflow: 'hidden' }}
            controls
            clickToPlay
            doubleClickToFullscreen
            allowFullscreen
            spaceKeyToPlayOrPause
            acknowledgeRemotionLicense
          />
        )}
        {err && <div className="warnbox"><Icon name="alert" size={14} /> Narration unavailable ({err}). Playing with captions only.</div>}
        {status && status.tts.engine !== 'piper' && <div className="warnbox"><Icon name="alert" size={14} /> Piper TTS not installed. Run <code>scripts/setup.ps1</code> to enable the voice-over.</div>}
      </div>

      <aside className="video-side">
        <div className="card">
          <h3><Icon name="film" size={16} /> {inc.stories[level].title}</h3>
          <p className="muted small">{L.label} cut · {scenes ? `${Math.round(totalFrames(scenes) / FPS)}s` : '…'} · {scenes?.length ?? 0} scenes · narrated by Piper ({level === 'layman' ? 'Amy' : level === 'analyst' ? 'Lessac' : 'Ryan'})</p>
          <div className="chapters">
            {tl.map(({ scene, from }) => {
              const e = scene.eventId ? evById.get(scene.eventId) : undefined;
              const active = frame >= from && frame < from + (tl.find((t) => t.scene === scene)?.dur ?? 0);
              return (
                <button key={scene.id} className={`chapter ${active ? 'on' : ''}`} onClick={() => { player.current?.seekTo(from); player.current?.play(); }}>
                  <span className="ch-dot" style={{ background: e ? PHASE_COLOR[e.phase] : '#64748b' }} />
                  <span className="ch-time">{e ? fmtClock(e.ts) : scene.kind === 'intro' ? 'Intro' : scene.kind === 'summary' ? 'Recap' : 'Actions'}</span>
                  <span className="ch-title">{scene.heading}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="card">
          <h3><Icon name="download" size={16} /> Export</h3>
          <p className="muted small">Render an MP4 (720p by default, RENDER_SCALE=1 for 1080p) with Remotion on the server: motion graphics plus voice-over, ready to share.</p>
          {job?.state === 'running' ? (
            <>
              <div className="progress"><div style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
              <div className="muted small">{job.message}</div>
            </>
          ) : job?.state === 'done' && job.url ? (
            <div className="row gap wrap">
              <a className="btn primary" href={job.url} download={`${c.id}-${level}.mp4`}><Icon name="download" size={14} /> Download MP4</a>
              <button className="btn ghost" onClick={() => api.render(c.id, level).then(setJob)}>Re-render</button>
            </div>
          ) : (
            <button className="btn primary" disabled={!scenes} onClick={() => api.render(c.id, level).then(setJob).catch((e) => setErr(e.message))}><Icon name="film" size={14} /> Render MP4</button>
          )}
          {job?.state === 'error' && <div className="error small">{job.error}</div>}
          <button className="btn ghost" style={{ marginTop: 10 }} disabled={!scenes} onClick={transcript}><Icon name="file" size={14} /> Download transcript</button>
        </div>
      </aside>
    </div>
  );
}
