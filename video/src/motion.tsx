/**
 * motion.tsx — 逐帧动画的少量原语。
 *
 * Remotion 把每一帧都当成一次纯函数渲染，所以这里只用 useCurrentFrame +
 * interpolate，不依赖时间轴副作用；同一个 frame 永远得到同一个画面。
 */
import React from 'react';
import { Easing, interpolate, useCurrentFrame } from 'remotion';

/** 0 → 1 的进度，clamp 在两端，缓动为 ease-out cubic。 */
export function useProgress(delay = 0, duration = 18): number {
  const frame = useCurrentFrame();
  return interpolate(frame - delay, [0, duration], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.out(Easing.cubic),
  });
}

export const Reveal: React.FC<{
  delay?: number;
  duration?: number;
  y?: number;
  x?: number;
  scale?: number;
  blur?: number;
  style?: React.CSSProperties;
  children: React.ReactNode;
}> = ({ delay = 0, duration = 18, y = 12, x = 0, scale = 1, blur = 0, style, children }) => {
  const p = useProgress(delay, duration);
  return (
    <div
      style={{
        opacity: p,
        transform: `translate3d(${(1 - p) * x}px, ${(1 - p) * y}px, 0) scale(${scale + (1 - scale) * p})`,
        filter: blur ? `blur(${(1 - p) * blur}px)` : undefined,
        willChange: 'transform, opacity',
        ...style,
      }}
    >
      {children}
    </div>
  );
};

/** 用于列表逐行入场：第 index 行延后 index * step 帧。 */
export const Rows: React.FC<{
  count: number;
  step?: number;
  delay?: number;
  duration?: number;
  y?: number;
  style?: React.CSSProperties;
  children: (index: number, wrap: (node: React.ReactNode) => React.ReactNode) => React.ReactNode;
}> = ({ count, step = 4, delay = 0, duration = 14, y = 8, style, children }) => {
  const wrap = (index: number) => (node: React.ReactNode) => (
    <Reveal delay={delay + index * step} duration={duration} y={y}>{node}</Reveal>
  );
  return (
    <div style={style}>
      {Array.from({ length: count }, (_, index) => (
        <React.Fragment key={index}>{children(index, wrap(index))}</React.Fragment>
      ))}
    </div>
  );
};
