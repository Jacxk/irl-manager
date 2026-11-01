'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
export type PreviewState = 'connecting' | 'playing' | 'waiting' | 'unsupported';
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
  const [state, setState] = useState<PreviewState>('connecting');
  useEffect(() => {
    const video = ref.current!;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let hls: Hls | undefined;
    const update = (next: PreviewState) => {
      if (!disposed) {
        setState(next);
        onState(next);
      }
    };
    const src = `/api/preview/${channelId}/index.m3u8`;
    const retry = () => {
      update('waiting');
      if (!timer)
        timer = setTimeout(() => {
          timer = undefined;
          start();
        }, 5000);
    };
    const playing = () => update('playing');
    const waiting = () => update('waiting');
    function start() {
      hls?.destroy();
      update('connecting');
      if (Hls.isSupported()) {
        hls = new Hls({ lowLatencyMode: true });
        hls.on(Hls.Events.ERROR, (_, data) => {
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
        void video.play().catch(() => {});
      } else update('unsupported');
    }
    video.addEventListener('playing', playing);
    video.addEventListener('waiting', waiting);
    video.addEventListener('error', retry);
    start();
    return () => {
      disposed = true;
      clearTimeout(timer);
      hls?.destroy();
      video.removeEventListener('playing', playing);
      video.removeEventListener('waiting', waiting);
      video.removeEventListener('error', retry);
      video.removeAttribute('src');
      video.load();
    };
  }, [channelId, source, onState]);
  return (
    <>
      <video
        ref={ref}
        className="absolute inset-0 size-full object-contain bg-black"
        autoPlay
        muted
        playsInline
        controls
        aria-label={source === 'input' ? 'Incoming stream preview' : 'Final program preview'}
      />
      {state !== 'playing' && (
        <div
          role="status"
          className="absolute bottom-12 inset-x-6 rounded-lg bg-black/85 p-3 text-center text-sm text-white"
        >
          {state === 'unsupported'
            ? 'This browser cannot play this stream codec. Try H.264 on your encoder.'
            : state === 'connecting'
              ? 'Connecting to preview…'
              : source === 'input'
                ? 'Waiting for incoming video. Retrying automatically…'
                : 'Waiting for program output. Retrying automatically…'}
        </div>
      )}
    </>
  );
}
