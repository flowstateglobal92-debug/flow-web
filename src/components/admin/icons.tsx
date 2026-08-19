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
};

export type AdminIcon = keyof typeof Icon;
