"use client";

import { memo } from "react";

interface VideoPlayerProps {
  src: string;
  className?: string;
}

const VideoPlayer = memo(function VideoPlayer({
  src,
  className = "",
}: VideoPlayerProps) {
  return (
    <video
      className={className}
      src={src}
      autoPlay
      muted
      loop
      playsInline
    />
  );
});

export default VideoPlayer;
