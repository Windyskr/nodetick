import type { CSSProperties } from 'react';

/**
 * NodeTick icon set — solid-glyph style matching the reference UI's sidebar.
 * All shapes are hand-authored (24×24 viewBox, currentColor).
 */

export interface IconProps {
  size?: number;
  className?: string;
  style?: CSSProperties;
}

const svgProps = (size: number, className?: string, style?: CSSProperties) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  className,
  style,
  'aria-hidden': true as const,
});

/** Rounded-square ring (shared by several icons). */
const RING = 'M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm0 1.7A3.3 3.3 0 0 0 4.7 8v8A3.3 3.3 0 0 0 8 19.3h8a3.3 3.3 0 0 0 3.3-3.3V8A3.3 3.3 0 0 0 16 4.7H8Z';

/** Calendar ring + top binding tabs (shared by date icons). */
const CAL_RING = 'M7.4 4.5h9.2a3.9 3.9 0 0 1 3.9 3.9v9.2a3.9 3.9 0 0 1-3.9 3.9H7.4a3.9 3.9 0 0 1-3.9-3.9V8.4a3.9 3.9 0 0 1 3.9-3.9Zm0 1.7a2.2 2.2 0 0 0-2.2 2.2v9.2a2.2 2.2 0 0 0 2.2 2.2h9.2a2.2 2.2 0 0 0 2.2-2.2V8.4a2.2 2.2 0 0 0-2.2-2.2H7.4Z';
const CAL_TABS = 'M7.3 2.1h2.2a.9.9 0 0 1 .9.9v2.4H6.4V3a.9.9 0 0 1 .9-.9Zm7.2 0h2.2a.9.9 0 0 1 .9.9v2.4h-4V3a.9.9 0 0 1 .9-.9Z';

/** 所有 — checklist square with a check. */
export function IconAll({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path fillRule="evenodd" d={RING} />
      <path d="M8.1 12.2l2.7 2.7 5.1-5.3" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 今天 / 最近7天 / 已过期 — calendar with a glyph (date number is live). */
export function IconCalendarGlyph({ glyph, size = 18, className, style, fontSize = 9.5 }: IconProps & { glyph: string; fontSize?: number }) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path fillRule="evenodd" d={CAL_RING} />
      <path d={CAL_TABS} />
      <text x="12" y="16.6" textAnchor="middle" fontSize={fontSize} fontWeight="700" fill="currentColor" style={{ fontFamily: 'inherit' }}>
        {glyph}
      </text>
    </svg>
  );
}

export function IconToday(props: IconProps) {
  return <IconCalendarGlyph {...props} glyph={String(new Date().getDate())} />;
}

export function IconNext7(props: IconProps) {
  return <IconCalendarGlyph {...props} glyph="7" />;
}

export function IconOverdue(props: IconProps) {
  return <IconCalendarGlyph {...props} glyph="!" fontSize={11} />;
}

/** 收集箱 — inbox tray with a slot. */
export function IconInbox({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M4 6.6h4c.5 0 .95.3 1.15.75a3.1 3.1 0 0 0 5.7 0c.2-.45.65-.75 1.15-.75h4A2.3 2.3 0 0 1 22.3 8.9v9.2a2.3 2.3 0 0 1-2.3 2.3H4a2.3 2.3 0 0 1-2.3-2.3V8.9A2.3 2.3 0 0 1 4 6.6Zm.3 6.4v3.1c0 .66.54 1.2 1.2 1.2h13a1.2 1.2 0 0 0 1.2-1.2V13h-3.9l-.9 1.5a1.7 1.7 0 0 1-1.45.82h-2.9a1.7 1.7 0 0 1-1.45-.82l-.9-1.5H4.3Z"
      />
    </svg>
  );
}

/** 摘要 — document with folded corner and text lines. */
export function IconDoc({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M6.2 2.8h7.4l5.6 5.6V19a2.2 2.2 0 0 1-2.2 2.2H6.2A2.2 2.2 0 0 1 4 19V5a2.2 2.2 0 0 1 2.2-2.2Zm1.6 8.2a1 1 0 0 0 0 2h4.4a1 1 0 0 0 0-2H7.8Zm0 3.6a1 1 0 0 0 0 2h6.4a1 1 0 0 0 0-2H7.8Z"
      />
      <path d="M13.6 2.8v4.5a1 1 0 0 0 1 1h4.6l-5.6-5.5Z" />
    </svg>
  );
}

/** 已完成 — solid square with a knocked-out check. */
export function IconCompleted({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M8 3h8a5 5 0 0 1 5 5v8a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8a5 5 0 0 1 5-5Zm-.65 9.85a1 1 0 0 0-1.45 1.38l2.9 3.05a1 1 0 0 0 1.46.01l6.1-6.4a1 1 0 1 0-1.44-1.38l-5.4 5.66-2.17-2.32Z"
      />
    </svg>
  );
}

/** 垃圾桶 — trash can with lid, handle and grooves. */
export function IconTrash({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path d="M5 5.7h14a1 1 0 0 1 0 2H5a1 1 0 0 1 0-2Z" />
      <path d="M9.2 5V4a1.9 1.9 0 0 1 1.9-1.9h1.8A1.9 1.9 0 0 1 14.8 4v1" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path
        fillRule="evenodd"
        d="M6.3 9.2h11.4l-.65 9A2.5 2.5 0 0 1 14.56 20.6H9.44a2.5 2.5 0 0 1-2.49-2.4L6.3 9.2Zm3.8 2.4a.95.95 0 0 1 1.9 0v4.8a.95.95 0 0 1-1.9 0v-4.8Zm2.9 0a.95.95 0 0 1 1.9 0v4.8a.95.95 0 0 1-1.9 0v-4.8Z"
      />
    </svg>
  );
}

/** 习惯 — loop ring with a check inside. */
export function IconHabit({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="none" stroke="currentColor">
      <path d="M17.6 7.2A7.9 7.9 0 1 0 19.9 12.6" strokeWidth="2.1" strokeLinecap="round" />
      <path d="M9.4 12.8l1.9 1.9 3.6-3.9" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** 倒数纪念日 — calendar with a heart. */
export function IconCountdown({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path fillRule="evenodd" d={CAL_RING} />
      <path d={CAL_TABS} />
      <path d="M12 17c-2.9-1.9-4.6-3.5-4.6-5.5a2.6 2.6 0 0 1 4.6-1.6 2.6 2.6 0 0 1 4.6 1.6c0 2-1.7 3.6-4.6 5.5Z" />
    </svg>
  );
}

/** 专注 — stopwatch. */
export function IconFocus({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="none" stroke="currentColor">
      <circle cx="12" cy="13.6" r="7" strokeWidth="2" />
      <path d="M12 13.6l3.2-3.2" strokeWidth="2" strokeLinecap="round" />
      <path d="M10.3 2.3h3.4a.9.9 0 0 1 .9.9v1.3H9.4V3.2a.9.9 0 0 1 .9-.9Z" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** 日历 — calendar with a dot grid. */
export function IconCalendar({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path fillRule="evenodd" d={CAL_RING} />
      <path d={CAL_TABS} />
      <circle cx="8.4" cy="12.3" r="1.15" />
      <circle cx="12" cy="12.3" r="1.15" />
      <circle cx="15.6" cy="12.3" r="1.15" />
      <circle cx="8.4" cy="15.9" r="1.15" />
      <circle cx="12" cy="15.9" r="1.15" />
      <circle cx="15.6" cy="15.9" r="1.15" />
    </svg>
  );
}

/** 四象限 — 2×2 rounded quadrants. */
export function IconMatrix({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path d="M5.8 4h3.2a1.8 1.8 0 0 1 1.8 1.8V9a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 9V5.8A1.8 1.8 0 0 1 5.8 4Z" />
      <path d="M15 4h3.2A1.8 1.8 0 0 1 20 5.8V9a1.8 1.8 0 0 1-1.8 1.8H15A1.8 1.8 0 0 1 13.2 9V5.8A1.8 1.8 0 0 1 15 4Z" />
      <path d="M5.8 13.2h3.2a1.8 1.8 0 0 1 1.8 1.8v3.2a1.8 1.8 0 0 1-1.8 1.8H5.8A1.8 1.8 0 0 1 4 18.2V15a1.8 1.8 0 0 1 1.8-1.8Z" />
      <path d="M15 13.2h3.2a1.8 1.8 0 0 1 1.8 1.8v3.2a1.8 1.8 0 0 1-1.8 1.8H15a1.8 1.8 0 0 1-1.8-1.8V15a1.8 1.8 0 0 1 1.8-1.8Z" />
    </svg>
  );
}

/** 搜索 — thin magnifier. */
export function IconSearch({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="none" stroke="currentColor">
      <circle cx="10.8" cy="10.8" r="6.4" strokeWidth="2" />
      <path d="M15.7 15.7l4.5 4.5" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** 通知 — bell. */
export function IconBell({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="none" stroke="currentColor">
      <path
        d="M12 3.2a5.8 5.8 0 0 1 5.8 5.8v3.4l1.5 2.6a1 1 0 0 1-.87 1.5H5.57a1 1 0 0 1-.87-1.5l1.5-2.6V9A5.8 5.8 0 0 1 12 3.2Z"
        strokeWidth="1.9"
        strokeLinejoin="round"
      />
      <path d="M9.9 19.6a2.2 2.2 0 0 0 4.2 0" strokeWidth="1.9" strokeLinecap="round" />
    </svg>
  );
}

/** 过滤器 — funnel. */
export function IconFunnel({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path d="M4.3 4.6h15.4a.9.9 0 0 1 .68 1.49l-6.02 6.9v5.5a1 1 0 0 1-1.4.92l-2.5-1.15a1 1 0 0 1-.58-.91v-4.36l-6.02-6.9A.9.9 0 0 1 4.3 4.6Z" />
    </svg>
  );
}

/** 标签 — price tag with a hole. */
export function IconTag({ size = 18, className, style }: IconProps) {
  return (
    <svg {...svgProps(size, className, style)} fill="currentColor">
      <path
        fillRule="evenodd"
        d="M13.4 3.4h4.8A2.8 2.8 0 0 1 21 6.2v4.8a2 2 0 0 1-.59 1.42l-8 8a2 2 0 0 1-2.82 0l-5.81-5.81a2 2 0 0 1 0-2.83l8-8a2 2 0 0 1 1.42-.58Zm2.9 6.1a1.7 1.7 0 1 0 0-3.4 1.7 1.7 0 0 0 0 3.4Z"
      />
    </svg>
  );
}
