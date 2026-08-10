/**
 * Barrel export for the hand-rolled Tailwind UI kit.
 *
 * ```ts
 * import { Button, Card, CardBody, Table, TBody, TR, TD } from "@/components/ui";
 * ```
 *
 * Client-only pieces (`Dialog`, `Tabs`, `Toast`) carry their own `"use client"`
 * directive, so importing this barrel from a server component is safe.
 */

export { Button, type ButtonProps, type ButtonSize, type ButtonVariant } from "./button";
export {
  Card,
  CardBody,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
  type CardBodyProps,
  type CardHeaderProps,
  type CardProps,
} from "./card";
export { Input, FIELD_BASE, FIELD_INVALID, type InputProps } from "./input";
export { Textarea, type TextareaProps } from "./textarea";
export { Select, type SelectOption, type SelectProps } from "./select";
export { Label, Field, type FieldProps, type LabelProps } from "./label";
export {
  Table,
  TableCaption,
  TBody,
  TD,
  TFoot,
  TH,
  THead,
  TR,
  type CellAlign,
  type TableProps,
  type TDProps,
  type THProps,
  type TRProps,
} from "./table";
export { Badge, type BadgeProps, type BadgeVariant } from "./badge";
export { Dialog, type DialogProps } from "./dialog";
export { Tabs, TabsContent, TabsList, TabsTrigger, type TabsProps } from "./tabs";
export {
  Toaster,
  ToastProvider,
  useToast,
  type Toast,
  type ToastApi,
  type ToastOptions,
  type ToastVariant,
} from "./toast";
export { EmptyState, type EmptyStateProps } from "./empty-state";
export { StatTile, StatTileRow, type StatTileProps, type StatTileTrend } from "./stat-tile";
export { PageHeader, type Breadcrumb, type PageHeaderProps } from "./page-header";
export { LoadingPanel, Spinner, type SpinnerProps } from "./spinner";
export { ForbiddenView, type ForbiddenViewProps } from "./forbidden";
