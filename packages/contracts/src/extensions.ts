export interface ExtensionField {
  type?: string;
  label?: string;
  description?: string;
  secret?: boolean;
  values?: string[];
  labels?: Record<string, string>;
  min?: number;
  max?: number;
}
export interface ExtensionDto {
  id: string;
  type: string;
  name: string;
  version: string;
  scope: string;
  description?: string;
  enabled: boolean;
  active: boolean;
  reason?: string;
  settings: Record<string, unknown>;
  settingsSchema: Record<string, ExtensionField>;
  details: Record<string, unknown>;
}
export interface ExtensionTabDto {
  id: string;
  label: string;
  template: string;
  scope?: string;
  type?: string | null;
  ownerId?: string;
  page?: string;
  script?: string;
  dataUrl?: string;
  hint?: string;
}
export interface ExtensionPayload {
  type: string;
  title?: string;
  text?: string;
  label?: string;
  value?: unknown;
  actionId?: string;
  href?: string;
  submitLabel?: string;
  name?: string;
  children?: ExtensionPayload[];
  items?: unknown[];
  columns?: (string | { key: string; label?: string })[];
  rows?: (Record<string, unknown> | unknown[])[];
  fields?: { name: string; label?: string; value?: string; type?: string }[];
}
export interface ExtensionContributionDto {
  ownerId: string;
  id: string;
  point: string;
  title: string;
  kind: string;
  payload: ExtensionPayload;
  actions: { id: string; label: string; actionId: string }[];
}
