/** 线性图标集合（统一 viewBox 0 0 24 24，stroke 风格）。 */
import React from 'react';

const base = (props, children) =>
  React.createElement(
    'svg',
    {
      viewBox: '0 0 24 24',
      width: props.size || 18,
      height: props.size || 18,
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth: props.strokeWidth || 1.9,
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
      'aria-hidden': props['aria-hidden'] ?? true,
      className: props.className,
      style: props.style,
    },
    children,
  );

export const IconSearch = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'c', cx: 11, cy: 11, r: 7 }),
    React.createElement('path', { key: 'l', d: 'M16.6 16.6 21 21' }),
  ]);

export const IconGlobe = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }),
    React.createElement('path', { key: 'a', d: 'M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18z' }),
  ]);

export const IconHistory = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M12 7v5l3 2' }),
    React.createElement('path', { key: 'b', d: 'M3.5 12a8.5 8.5 0 1 0 2.6-6.1M3 4v4h4' }),
  ]);

export const IconSettings = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 3 }),
    React.createElement('path', {
      key: 'p',
      d: 'M19.4 15a1.6 1.6 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.8-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.8 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.8.3H9a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.8V9a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1z',
    }),
  ]);

export const IconDownload = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M12 3v12m0 0-4-4m4 4 4-4M4 19h16' })]);

export const IconCopy = (p = {}) =>
  base(p, [
    React.createElement('rect', { key: 'r', x: 9, y: 9, width: 11, height: 11, rx: 2 }),
    React.createElement('path', { key: 'p', d: 'M5 15V5a2 2 0 0 1 2-2h8' }),
  ]);

export const IconCheck = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M4 12.5l5 5L20 6.5' })]);

export const IconClose = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M6 6l12 12M18 6 6 18' })]);

export const IconTrash = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2' }),
    React.createElement('path', { key: 'b', d: 'M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12' }),
    React.createElement('path', { key: 'c', d: 'M10 11v6M14 11v6' }),
  ]);

export const IconExternal = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M14 4h6v6M20 4l-8 8' }),
    React.createElement('path', { key: 'b', d: 'M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5' }),
  ]);

export const IconAlert = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M12 3.5 2.5 20h19z' }),
    React.createElement('path', { key: 'b', d: 'M12 10v4.5M12 17.4v.1' }),
  ]);

export const IconInfo = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }),
    React.createElement('path', { key: 'a', d: 'M12 11v5.5M12 7.6v.1' }),
  ]);

export const IconSpark = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z' }),
    React.createElement('path', { key: 'b', d: 'M18.5 16.5l.7 1.8 1.8.7-1.8.7-.7 1.8-.7-1.8-1.8-.7 1.8-.7z' }),
  ]);

export const IconShield = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M12 3l7 3v6c0 4.4-3 8.1-7 9-4-.9-7-4.6-7-9V6z' }),
    React.createElement('path', { key: 'b', d: 'M9 12.2l2.2 2.2L15.5 10' }),
  ]);

export const IconSun = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 4 }),
    React.createElement('path', { key: 'p', d: 'M12 2v2m0 16v2M2 12h2m16 0h2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M19.1 4.9l-1.4 1.4M6.3 17.7l-1.4 1.4' }),
  ]);

export const IconMoon = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z' })]);

export const IconBook = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M4 5.5A1.5 1.5 0 0 1 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z' }),
    React.createElement('path', { key: 'b', d: 'M20 5.5A1.5 1.5 0 0 0 18.5 4H13v16h5.5a1.5 1.5 0 0 0 1.5-1.5z' }),
  ]);

export const IconClock = (p = {}) =>
  base(p, [React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 9 }), React.createElement('path', { key: 'p', d: 'M12 7.5V12l3 1.8' })]);

export const IconList = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M4 6h16M4 12h16M4 18h10' })]);

export const IconLayers = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M12 3l9 5-9 5-9-5z' }),
    React.createElement('path', { key: 'b', d: 'M3 13l9 5 9-5' }),
  ]);

export const IconMenu = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M4 7h16M4 12h16M4 17h16' })]);

export const IconKey = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'c', cx: 8, cy: 12, r: 4 }),
    React.createElement('path', { key: 'p', d: 'M12 12h9M17 12v3M20 12v2' }),
  ]);

export const IconWifi = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M3.5 9a13 13 0 0 1 17 0' }),
    React.createElement('path', { key: 'b', d: 'M6.5 12.5a8.5 8.5 0 0 1 11 0' }),
    React.createElement('path', { key: 'c', d: 'M9.6 16a4 4 0 0 1 4.8 0' }),
    React.createElement('path', { key: 'd', d: 'M12 19.5v.1' }),
  ]);

export const IconChart = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }),
  ]);

export const IconInbox = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M3 13h5l1.5 3h5L16 13h5' }),
    React.createElement('path', { key: 'b', d: 'M5 5h14l2 8v5a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1v-5z' }),
  ]);

export const IconEye = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z' }),
    React.createElement('circle', { key: 'c', cx: 12, cy: 12, r: 2.6 }),
  ]);

export const IconEyeOff = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M4 4l16 16' }),
    React.createElement('path', { key: 'b', d: 'M9.9 5.7A9.6 9.6 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 3.9M6.5 7.8A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5c1.2 0 2.3-.2 3.3-.6' }),
  ]);

export const IconArrowLeft = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M15 5l-7 7 7 7' })]);

export const IconRefresh = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M20 11a8 8 0 0 0-14-4.5M4 13a8 8 0 0 0 14 4.5' }),
    React.createElement('path', { key: 'b', d: 'M6 3v4h4M18 21v-4h-4' }),
  ]);

export const IconFilter = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M4 5h16l-6 7v6l-4 2v-8z' })]);

export const IconSort = (p = {}) =>
  base(p, [React.createElement('path', { key: 'p', d: 'M7 4v16m0 0-3-3m3 3 3-3M17 20V4m0 0 3 3m-3-3-3 3' })]);

export const IconLink = (p = {}) =>
  base(p, [
    React.createElement('path', { key: 'a', d: 'M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1 1' }),
    React.createElement('path', { key: 'b', d: 'M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1-1' }),
  ]);

export const IconScissors = (p = {}) =>
  base(p, [
    React.createElement('circle', { key: 'a', cx: 6, cy: 6, r: 2.6 }),
    React.createElement('circle', { key: 'b', cx: 6, cy: 18, r: 2.6 }),
    React.createElement('path', { key: 'c', d: 'M20 4 8.6 15.4M20 20 8.6 8.6' }),
  ]);
