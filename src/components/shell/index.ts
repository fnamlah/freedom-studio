/**
 * Application chrome.
 *
 * ```ts
 * import { AppShell, navItemsForRole } from "@/components/shell";
 * ```
 */

export { AppShell, type AppShellProps } from "./app-shell";
export { SideNav, type SideNavProps } from "./side-nav";
export { TopBar, type TopBarProps } from "./top-bar";
export {
  NAV_SECTIONS,
  isNavItemActive,
  navItemsForRole,
  navSectionsForRole,
  type NavIconName,
  type NavItem,
  type NavSection,
} from "./nav";
export { NAV_ICONS, CloseIcon, MenuIcon, ShieldIcon, SignOutIcon } from "./icons";
