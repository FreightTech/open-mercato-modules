/*
  Public surface of the FMS-Componenets-aligned design-system layer.

  Components live alongside their Storybook stories so designers and
  engineers see the same artefacts. The legacy primitives under
  `../primitives/` are kept for Tier-3 backwards compatibility but
  carry `@deprecated` JSDoc pointing here.
*/

export { Alert, type AlertProps, type AlertVariant } from './Alert'
export { Avatar, AvatarStack, type AvatarProps, type AvatarSize, type AvatarStackProps } from './Avatar'
export { Badge, type BadgeProps, type BadgeSize, type BadgeVariant } from './Badge'
export { Breadcrumb, type BreadcrumbItem, type BreadcrumbProps } from './Breadcrumb'
export {
  Button,
  type ButtonProps,
  type ButtonVariant,
  type ButtonSize,
  type ButtonIconPosition,
} from './Button'
export { Checkbox, type CheckboxProps } from './Checkbox'
export { IconButton, type IconButtonProps } from './IconButton'
export { Input, type InputProps, type InputSize } from './Input'
export { NavGroup, type NavGroupProps } from './NavGroup'
export { NavItem, type NavItemProps } from './NavItem'
export { SearchInput, type SearchInputProps } from './SearchInput'
export { Sidebar, SidebarFooter, SidebarHeader, type SidebarProps, type SidebarHeaderProps, type SidebarFooterProps } from './Sidebar'
export { Tab, TabBar, type TabProps, type TabBarProps } from './Tab'
export { Tag, type TagProps, type TagVariant } from './Tag'
export { Toggle, type ToggleProps, type ToggleSize } from './Toggle'
export { Topbar, type TopbarProps } from './Topbar'
