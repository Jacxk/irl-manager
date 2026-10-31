'use client';
import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';
export function Preview({ channelId }: { channelId: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    const video = ref.current!;
    const src = `/api/preview/${channelId}/index.m3u8`;
    if (Hls.isSupported()) {
      const hls = new Hls({ lowLatencyMode: true });
      hls.loadSource(src);
      hls.attachMedia(video);
      hls.on(Hls.Events.ERROR, (_, data) => {
        if (data.fatal)
          setError('Preview is unavailable. The program output may still be starting.');
      });
      return () => hls.destroy();
    }
    if (video.canPlayType('application/vnd.apple.mpegurl')) video.src = src;
    else setError('This browser does not support HLS playback.');
  }, [channelId]);
  return (
    <>
      <video
        ref={ref}
        className="absolute inset-0 size-full object-contain bg-black"
        autoPlay
        muted
        playsInline
        controls
        aria-label="Final program preview"
        onError={() =>
          setError('Preview is unavailable. Try reopening it once the output is ready.')
        }
      />
      {error && (
        <div
          role="status"
          className="absolute bottom-12 inset-x-6 rounded-lg bg-black/85 p-3 text-center text-sm text-destructive"
        >
          {error}
        </div>
      )}
    </>
  );
}
