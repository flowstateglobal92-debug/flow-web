import type { SVGProps } from "react";

/** 18px / stroke 1.6 line icons — same drawing language as the marketing OS demo. */
type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const Icon = {
  dashboard: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="3.5" y="3.5" width="7" height="8.5" rx="1.2" />
      <rect x="13.5" y="3.5" width="7" height="5" rx="1.2" />
      <rect x="3.5" y="15" width="7" height="5.5" rx="1.2" />
      <rect x="13.5" y="11.5" width="7" height="9" rx="1.2" />
    </svg>
  ),
  inbox: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4 5h16v11H9l-5 4z" />
      <path d="M8 9h8M8 12.5h5" />
    </svg>
  ),
  pipeline: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="3" y="4" width="5" height="16" rx="1.5" />
      <rect x="9.5" y="4" width="5" height="11" rx="1.5" />
      <rect x="16" y="4" width="5" height="7" rx="1.5" />
    </svg>
  ),
  ledger: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="4" y="3.5" width="16" height="17" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </svg>
  ),
  calendar: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M8 3v4M16 3v4" />
    </svg>
  ),
  plus: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  ),
  search: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4-4" />
    </svg>
  ),
  close: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m6 6 12 12M18 6 6 18" />
    </svg>
  ),
  check: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m5 12 4.5 4.5L19 7" />
    </svg>
  ),
  trash: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13" />
      <path d="M10.5 11v5M13.5 11v5" />
    </svg>
  ),
  edit: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4 20h4L20 8l-4-4L4 16z" />
      <path d="m14.5 5.5 4 4" />
    </svg>
  ),
  arrow: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  ),
  chevron: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  ),
  chevronLeft: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m15 6-6 6 6 6" />
    </svg>
  ),
  chevronRight: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m9 6 6 6-6 6" />
    </svg>
  ),
  logout: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M15 4h3.5A1.5 1.5 0 0 1 20 5.5v13a1.5 1.5 0 0 1-1.5 1.5H15" />
      <path d="M11 8 7 12l4 4M7 12h9" />
    </svg>
  ),
  drag: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="9" cy="6" r="1" fill="currentColor" />
      <circle cx="15" cy="6" r="1" fill="currentColor" />
      <circle cx="9" cy="12" r="1" fill="currentColor" />
      <circle cx="15" cy="12" r="1" fill="currentColor" />
      <circle cx="9" cy="18" r="1" fill="currentColor" />
      <circle cx="15" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  lock: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  ),
  bolt: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
    </svg>
  ),
  up: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 19V6M6 12l6-6 6 6" />
    </svg>
  ),
  down: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 5v13M18 12l-6 6-6-6" />
    </svg>
  ),
  mail: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </svg>
  ),
  phone: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M6 3.5h3l1.5 4-2 1.5a11 11 0 0 0 6.5 6.5l1.5-2 4 1.5v3a2 2 0 0 1-2.2 2A16.5 16.5 0 0 1 4 5.7 2 2 0 0 1 6 3.5z" />
    </svg>
  ),
  note: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h4" />
    </svg>
  ),
  send: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M21 3 10.5 13.5" />
      <path d="M21 3 14.5 21l-4-7.5L3 9.5z" />
    </svg>
  ),
  reply: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m9 7-5 5 5 5" />
      <path d="M4 12h9a7 7 0 0 1 7 7v1" />
    </svg>
  ),
  forward: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m15 7 5 5-5 5" />
      <path d="M20 12h-9a7 7 0 0 0-7 7v1" />
    </svg>
  ),
  paperclip: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M20 11.5 12.2 19.3a4.5 4.5 0 0 1-6.4-6.4l8-8a3 3 0 0 1 4.2 4.2l-8 8a1.5 1.5 0 0 1-2.1-2.1l7.4-7.4" />
    </svg>
  ),
  star: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m12 3.6 2.6 5.3 5.9.9-4.3 4.1 1 5.8-5.2-2.7-5.2 2.7 1-5.8L3.5 9.8l5.9-.9z" />
    </svg>
  ),
  archive: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="3" y="4" width="18" height="4" rx="1" />
      <path d="M5 8v11a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8M10 12h4" />
    </svg>
  ),
  refresh: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </svg>
  ),
  image: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="3" y="4.5" width="18" height="15" rx="2" />
      <circle cx="8.5" cy="9.5" r="1.5" />
      <path d="m4 17 4.5-4.5 3.5 3.5 3-2.5L20 17" />
    </svg>
  ),
  users: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="9" cy="8.5" r="3.2" />
      <path d="M3.5 19.5a5.5 5.5 0 0 1 11 0" />
      <path d="M15.5 5.6a3.1 3.1 0 0 1 0 5.8M17.5 14.4a5.4 5.4 0 0 1 3 5.1" />
    </svg>
  ),
  user: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="8.5" r="3.6" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </svg>
  ),
  bell: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M6 16.5V11a6 6 0 1 1 12 0v5.5l1.5 2h-15z" />
      <path d="M10 20.5a2.2 2.2 0 0 0 4 0" />
    </svg>
  ),
  receipt: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M6 3.5h12v17l-2.5-1.6-2 1.6-1.5-1.2-1.5 1.2-2-1.6L6 20.5z" />
      <path d="M9 8h6M9 11.5h6M9 15h3.5" />
    </svg>
  ),
  checklist: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="m4 6.5 1.6 1.6L8.5 5M4 12.5l1.6 1.6 2.9-3.1M4 18.5l1.6 1.6 2.9-3.1" />
      <path d="M11.5 7h8.5M11.5 13h8.5M11.5 19h8.5" />
    </svg>
  ),
  settings: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.4-2-3.4-2.2.9a7.5 7.5 0 0 0-2.6-1.5L14.2 3h-4l-.3 2.1a7.5 7.5 0 0 0-2.6 1.5l-2.2-.9-2 3.4 1.9 1.4a7.6 7.6 0 0 0 0 3l-1.9 1.4 2 3.4 2.2-.9a7.5 7.5 0 0 0 2.6 1.5l.3 2.1h4l.3-2.1a7.5 7.5 0 0 0 2.6-1.5l2.2.9 2-3.4z" />
    </svg>
  ),
  printer: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M7 8V3.5h10V8" />
      <rect x="3.5" y="8" width="17" height="8" rx="1.5" />
      <path d="M7 13.5h10v7H7z" />
    </svg>
  ),
  download: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 4v11M7.5 10.5 12 15l4.5-4.5M4.5 19.5h15" />
    </svg>
  ),
  upload: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 15V4M7.5 8.5 12 4l4.5 4.5M4.5 19.5h15" />
    </svg>
  ),
  eye: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  ),
  at: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="3.6" />
      <path d="M15.6 12v1.4a2.6 2.6 0 0 0 5.2 0V12a8.8 8.8 0 1 0-3.5 7" />
    </svg>
  ),
  shield: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 3.5 5 6v5.5c0 4.4 3 7.8 7 9 4-1.2 7-4.6 7-9V6z" />
      <path d="m9 12 2.2 2.2L15.5 10" />
    </svg>
  ),
  copy: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <rect x="8" y="8" width="12" height="12" rx="1.5" />
      <path d="M16 8V5.5A1.5 1.5 0 0 0 14.5 4h-9A1.5 1.5 0 0 0 4 5.5v9A1.5 1.5 0 0 0 5.5 16H8" />
    </svg>
  ),
  building: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4.5 20.5V5.5l8-2v17M12.5 8.5h7v12" />
      <path d="M7.5 8.5h2M7.5 12h2M7.5 15.5h2M15.5 12h1.5M15.5 15.5h1.5M3 20.5h18" />
    </svg>
  ),
  history: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
      <path d="M3.5 4v4h4M12 7.5V12l3 2" />
    </svg>
  ),
  command: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M9 9V6.5A2.5 2.5 0 1 0 6.5 9H9zm0 0h6m-6 0v6m6-6V6.5A2.5 2.5 0 1 1 17.5 9H15zm0 0v6m0 0h2.5a2.5 2.5 0 1 1-2.5 2.5V15zm0 0H9m0 0v2.5A2.5 2.5 0 1 1 6.5 15H9z" />
    </svg>
  ),
  repeat: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M17 3.5 20 6.5l-3 3" />
      <path d="M4 11.5V10a3.5 3.5 0 0 1 3.5-3.5H20M7 20.5 4 17.5l3-3" />
      <path d="M20 12.5V14a3.5 3.5 0 0 1-3.5 3.5H4" />
    </svg>
  ),
  chart: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4 4v16h16" />
      <path d="m7.5 14.5 3.5-4 3 2.5 5-6" />
    </svg>
  ),
  scale: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 4v16M7 20h10M5 7h14" />
      <path d="m5 7-2.5 6a2.5 2.5 0 0 0 5 0zM19 7l-2.5 6a2.5 2.5 0 0 0 5 0z" />
    </svg>
  ),
  plane: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M10.5 13.5 3 11l1.5-1.5 7.5.5 4.5-5a1.8 1.8 0 0 1 2.5 2.5l-5 4.5.5 7.5L13 21l-2.5-7.5" />
    </svg>
  ),
  clock: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  ),
  flag: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M5 21V4M5 4.5h11l-2 4 2 4H5" />
    </svg>
  ),
  more: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="5.5" cy="12" r="1.1" />
      <circle cx="12" cy="12" r="1.1" />
      <circle cx="18.5" cy="12" r="1.1" />
    </svg>
  ),
  filter: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4 5.5h16l-6.2 7.2V19l-3.6-1.8v-4.5z" />
    </svg>
  ),
  link: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1" />
      <path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1" />
    </svg>
  ),
  pin: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0c0 5.4-6.5 11-6.5 11z" />
      <circle cx="12" cy="10" r="2.3" />
    </svg>
  ),
  message: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <path d="M4 5.5h16v10.5H10l-4.5 3.5V16H4z" />
    </svg>
  ),
  sun: ({ size, ...p }: IconProps) => (
    <svg {...base(size)} {...p}>
      <circle cx="12" cy="12" r="3.8" />
      <path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4" />
    </svg>
  ),
};

export type AdminIcon = keyof typeof Icon;
