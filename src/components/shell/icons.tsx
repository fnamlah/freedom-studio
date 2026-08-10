import type { SVGProps } from "react";

import type { NavIconName } from "@/components/shell/nav";

/**
 * Inline icon set. Deliberately hand-rolled rather than a dependency: the CSP in
 * docs/08 §4.1 forbids third-party runtime assets, and these are ~20 paths.
 */

type IconProps = SVGProps<SVGSVGElement>;

function Icon({ children, ...props }: IconProps) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={16}
      height={16}
      {...props}
    >
      {children}
    </svg>
  );
}

export const NAV_ICONS: Record<NavIconName, (props: IconProps) => React.ReactElement> = {
  dashboard: (props) => (
    <Icon {...props}>
      <rect x="3" y="3" width="7" height="9" rx="1.5" />
      <rect x="14" y="3" width="7" height="5" rx="1.5" />
      <rect x="14" y="12" width="7" height="9" rx="1.5" />
      <rect x="3" y="16" width="7" height="5" rx="1.5" />
    </Icon>
  ),
  models: (props) => (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </Icon>
  ),
  operators: (props) => (
    <Icon {...props}>
      <circle cx="9" cy="8" r="3" />
      <path d="M3 19a6 6 0 0 1 12 0" />
      <path d="M16 6.5a3 3 0 0 1 0 5.8" />
      <path d="M17.5 14.5A5.5 5.5 0 0 1 21 19" />
    </Icon>
  ),
  platforms: (props) => (
    <Icon {...props}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3a14 14 0 0 1 0 18a14 14 0 0 1 0-18" />
    </Icon>
  ),
  sessions: (props) => (
    <Icon {...props}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Icon>
  ),
  earnings: (props) => (
    <Icon {...props}>
      <path d="M3 17.5 9 11l4 3.5 7.5-8" />
      <path d="M15.5 6.5H21V12" />
    </Icon>
  ),
  documents: (props) => (
    <Icon {...props}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <path d="M14 3v5h5" />
    </Icon>
  ),
  library: (props) => (
    <Icon {...props}>
      <path d="M4 5a1 1 0 0 1 1-1h4l2 2h8a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1z" />
      <path d="M8 12h8" />
    </Icon>
  ),
  schemes: (props) => (
    <Icon {...props}>
      <circle cx="7" cy="7" r="3" />
      <circle cx="17" cy="17" r="3" />
      <path d="M19 5 5 19" />
    </Icon>
  ),
  ledger: (props) => (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 8h8M8 12h8M8 16h5" />
    </Icon>
  ),
  payouts: (props) => (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 12h.01M18 12h.01" />
    </Icon>
  ),
  statements: (props) => (
    <Icon {...props}>
      <path d="M5 3h14v18l-3.5-2-3.5 2-3.5-2L5 21z" />
      <path d="M9 8h6M9 12h6" />
    </Icon>
  ),
  forecasts: (props) => (
    <Icon {...props}>
      <path d="M3 20V4" />
      <path d="M3 17h18" />
      <path d="M7 14l4-5 3 3 5-7" strokeDasharray="0" />
    </Icon>
  ),
  ai: (props) => (
    <Icon {...props}>
      <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
      <rect x="7" y="7" width="10" height="10" rx="3" />
      <circle cx="12" cy="12" r="1.5" />
    </Icon>
  ),
  reports: (props) => (
    <Icon {...props}>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 13v4M12 9v8M16 12v5" />
    </Icon>
  ),
  users: (props) => (
    <Icon {...props}>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 20a7 7 0 0 1 14 0" />
    </Icon>
  ),
  invitations: (props) => (
    <Icon {...props}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="m3.5 7 8.5 6 8.5-6" />
    </Icon>
  ),
  audit: (props) => (
    <Icon {...props}>
      <path d="M4 6a2 2 0 0 1 2-2h9l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" />
      <path d="M14 4v5h5" />
      <path d="M8 14h6M8 17h4" />
    </Icon>
  ),
  settings: (props) => (
    <Icon {...props}>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
    </Icon>
  ),
};

export function SignOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 21H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3" />
      <path d="m16 17 5-5-5-5" />
      <path d="M21 12H9" />
    </Icon>
  );
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 6h16M4 12h16M4 18h16" />
    </Icon>
  );
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Icon>
  );
}

export function ShieldIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3l7 3v5.5c0 4.4-3 8.2-7 9.5-4-1.3-7-5.1-7-9.5V6z" />
      <path d="m9.5 12 1.8 1.8 3.4-3.6" />
    </Icon>
  );
}
