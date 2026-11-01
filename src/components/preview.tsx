'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
import { Maximize, Minimize, Pause, Play, Radio, RefreshCw, Volume2, VolumeX } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './ui/button';
import { Slider } from './ui/slider';
export type PreviewState =
  'connecting' | 'playing' | 'waiting' | 'unsupported' | 'paused' | 'offline';
export function Preview({
  channelId,
  source,
  onState,
}: {
  channelId: string;
  source: 'input' | 'program';
  onState: (state: PreviewState) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const userPaused = useRef(false);
  const [state, setState] = useState<PreviewState>('connecting');
  const [muted, setMuted] = useState(true);
  const [paused, setPaused] = useState(true);
  const [volume, setVolume] = useState(1);
  const [fullscreen, setFullscreen] = useState(false);
  const [revision, setRevision] = useState(0);
  const [playbackError, setPlaybackError] = useState('');
  useEffect(() => {
    const change = () => setFullscreen(document.fullscreenElement === container.current);
    document.addEventListener('fullscreenchange', change);
    return () => document.removeEventListener('fullscreenchange', change);
  }, []);
  useEffect(() => {
    const video = ref.current!;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hls: Hls | undefined;
    let hadVideo = false;
    let offline = false;
    let lastProgress = Date.now();
    let lastTime = 0;
    const update = (next: PreviewState) => {
      if (!disposed) {
        setState(next);
        onState(next);
      }
    };
    const src = `/api/preview/${channelId}/index.m3u8`;
    const retry = () => {
      if (hadVideo) {
        stopPreview();
        return;
      }
      update(userPaused.current ? 'paused' : 'waiting');
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          start();
        }, 5000);
    };
    function stopPreview() {
      if (disposed) return;
      offline = true;
      const current = hls;
      hls = undefined;
      current?.destroy();
      video.pause();
      video.removeAttribute('src');
      video.load();
      setPlaybackError('');
      update('offline');
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          start();
        }, 5000);
    }
    const progress = () => {
      if (video.currentTime !== lastTime) {
        lastTime = video.currentTime;
        lastProgress = Date.now();
      }
    };
    const playing = () => {
      hadVideo = true;
      offline = false;
      lastProgress = Date.now();
      setPlaybackError('');
      update('playing');
    };
    const waiting = () => {
      if (!offline) update(userPaused.current ? 'paused' : 'waiting');
    };
    const pause = () => {
      setPaused(true);
      if (userPaused.current && !offline) update('paused');
    };
    const play = () => setPaused(false);
    const audio = () => {
      setMuted(video.muted);
      setVolume(video.volume);
    };
    function start() {
      const current = hls;
      hls = undefined;
      current?.destroy();
      video.autoplay = !userPaused.current;
      lastProgress = Date.now();
      update(offline ? 'offline' : userPaused.current ? 'paused' : 'connecting');
      if (Hls.isSupported()) {
        const player = new Hls({ lowLatencyMode: true });
        hls = player;
        player.on(Hls.Events.ERROR, (_, data) => {
          if (disposed || hls !== player) return;
          if (data.fatal) {
            if (data.details === Hls.ErrorDetails.MANIFEST_INCOMPATIBLE_CODECS_ERROR)
              update('unsupported');
            else retry();
          }
        });
        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        video.load();
        if (!userPaused.current)
          void video.play().catch(() => {
            if (!disposed) setPlaybackError('Press Play to start the preview.');
          });
      } else update('unsupported');
    }
    video.addEventListener('ended', stopPreview);
    video.addEventListener('timeupdate', progress);
    const watchdog = setInterval(() => {
      if (hadVideo && !offline && !userPaused.current && Date.now() - lastProgress > 10000)
        stopPreview();
    }, 1000);
    video.addEventListener('playing', playing);
    video.addEventListener('waiting', waiting);
    video.addEventListener('pause', pause);
    video.addEventListener('play', play);
    video.addEventListener('volumechange', audio);
    video.addEventListener('error', retry);
    start();
    return () => {
      disposed = true;
      clearTimeout(timer);
      clearInterval(watchdog);
      video.removeEventListener('ended', stopPreview);
      video.removeEventListener('timeupdate', progress);
      video.removeEventListener('playing', playing);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('pause', pause);
      video.removeEventListener('play', play);
      video.removeEventListener('volumechange', audio);
      video.removeEventListener('error', retry);
      hls?.destroy();
      video.removeAttribute('src');
      video.load();
    };
  }, [channelId, source, onState, revision]);
  async function togglePlayback() {
    if (state === 'offline') {
      userPaused.current = false;
      setRevision((r) => r + 1);
      return;
    }
    const video = ref.current!;
    if (!video.paused) {
      userPaused.current = true;
      video.pause();
    } else {
      userPaused.current = false;
      try {
        await video.play();
        setPlaybackError('');
      } catch {
        setPlaybackError('Unable to play the preview. Try reconnecting.');
      }
    }
  }
  function toggleMute() {
    const video = ref.current!;
    const silent = video.muted || video.volume === 0;
    if (video.volume === 0) video.volume = 0.5;
    video.muted = !silent;
  }
  async function toggleFullscreen() {
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen();
      else if (container.current?.requestFullscreen) await container.current.requestFullscreen();
      else {
        const video = ref.current as
          (HTMLVideoElement & { webkitEnterFullscreen?: () => void }) | null;
        if (video?.webkitEnterFullscreen) video.webkitEnterFullscreen();
        else toast.error('Fullscreen is unavailable in this browser.');
      }
    } catch {
      toast.error('Unable to enter fullscreen. Try again.');
    }
  }
  const controlClass =
    'shrink-0 text-white/80 hover:bg-white/10 hover:text-white focus-visible:ring-white';
  return (
    <div
      ref={container}
      role="region"
      aria-label="Stream preview player"
      tabIndex={0}
      className="absolute inset-0 bg-black text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary"
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey) return;
        if (e.key === ' ' || e.key.toLowerCase() === 'k') {
          e.preventDefault();
          void togglePlayback();
        }
        if (e.key.toLowerCase() === 'm') {
          e.preventDefault();
          toggleMute();
        }
        if (e.key.toLowerCase() === 'f') {
          e.preventDefault();
          void toggleFullscreen();
        }
      }}
    >
      <video
        ref={ref}
        className={`absolute inset-0 size-full object-contain ${state === 'offline' ? 'invisible' : ''}`}
        autoPlay
        muted
        playsInline
        aria-label={source === 'input' ? 'Incoming stream preview' : 'Final program preview'}
      />
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-gradient-to-b from-black/80 to-transparent p-4 pb-12">
        <span className="inline-flex items-center gap-2 rounded-md border border-white/15 bg-black/50 px-2.5 py-1.5 font-mono text-[9px] tracking-widest text-white/80">
          <Radio size={12} className={state === 'playing' ? 'text-primary' : 'text-white/50'} />
          {source === 'input' ? 'INPUT PREVIEW · NOT LIVE' : 'PROGRAM PREVIEW'}
        </span>
      </div>
      {(state !== 'playing' || playbackError) && (
        <div
          role="status"
          className="pointer-events-none absolute bottom-20 inset-x-5 rounded-lg border border-white/10 bg-black/80 p-3 text-center text-xs leading-relaxed text-white/80"
        >
          {playbackError ||
            (state === 'unsupported'
              ? 'This browser cannot play this stream codec. Try H.264 on your encoder.'
              : state === 'offline'
                ? 'Stream ended. Waiting for a new stream.'
                : state === 'paused'
                  ? 'Preview paused. Your stream continues.'
                  : state === 'connecting'
                    ? 'Connecting to preview…'
                    : source === 'input'
                      ? 'Waiting for incoming video. Retrying automatically…'
                      : 'Waiting for program output. Retrying automatically…')}
        </div>
      )}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/90 to-transparent px-3 pb-3 pt-8">
        <div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-1.5 py-1 backdrop-blur-md">
          <Button
            variant="ghost"
            size="icon"
            className={controlClass}
            aria-label={paused ? 'Play preview' : 'Pause preview playback'}
            title="Play / pause (Space)"
            onClick={() => void togglePlayback()}
          >
            {paused ? <Play size={17} /> : <Pause size={17} />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={controlClass}
            aria-label={muted || volume === 0 ? 'Unmute preview' : 'Mute preview'}
            title="Mute (M)"
            onClick={toggleMute}
          >
            {muted || volume === 0 ? <VolumeX size={17} /> : <Volume2 size={17} />}
          </Button>
          <Slider
            className="mr-2 w-14 sm:w-20 shrink-0"
            aria-label="Preview volume"
            min={0}
            max={1}
            step={0.05}
            value={[muted ? 0 : volume]}
            onValueChange={([next]) => {
              const video = ref.current!;
              video.volume = next;
              video.muted = next === 0;
            }}
          />
          <span className="flex min-w-0 flex-1 items-center gap-1.5 pl-1 font-mono text-[9px] uppercase tracking-wider text-white/70">
            <span
              className={`size-1.5 shrink-0 rounded-full ${state === 'playing' ? 'bg-primary' : 'bg-white/35'}`}
            />
            {state === 'playing' ? 'Receiving' : state === 'paused' ? 'Paused' : 'Preview'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className={controlClass}
            aria-label="Reconnect preview"
            title="Reconnect preview"
            onClick={() => {
              setPlaybackError('');
              setRevision((r) => r + 1);
            }}
          >
            <RefreshCw size={15} />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className={controlClass}
            aria-label={fullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
            title="Fullscreen (F)"
            onClick={() => void toggleFullscreen()}
          >
            {fullscreen ? <Minimize size={17} /> : <Maximize size={17} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
