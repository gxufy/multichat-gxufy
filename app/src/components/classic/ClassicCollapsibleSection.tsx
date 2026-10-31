import type { ReactNode } from 'react';

export const CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY =
  'gxufy:multichat:collapsed-sections:v1';

export const CLASSIC_COLLAPSIBLE_SECTION_IDS = [
  'chat-text',
  'chat-appearance',
  'chat-emotes',
  'chat-messages',
  'chat-events',
  'chat-extras',
  'chat-filters',
  'chat-commands',
  'counter-typography',
  'counter-layout',
  'counter-display',
] as const;

export type ClassicCollapsibleSectionId =
  (typeof CLASSIC_COLLAPSIBLE_SECTION_IDS)[number];

const SECTION_ID_SET = new Set<string>(CLASSIC_COLLAPSIBLE_SECTION_IDS);
const DEFAULT_COLLAPSED_SECTION_IDS: readonly ClassicCollapsibleSectionId[] = [
  'chat-filters',
  'chat-commands',
];

export function defaultCollapsedSections(): Set<ClassicCollapsibleSectionId> {
  return new Set(DEFAULT_COLLAPSED_SECTION_IDS);
}

/** Read only known section ids; invalid storage falls back to layout defaults. */
export function readCollapsedSections(
  storage: Pick<Storage, 'getItem'> | null,
): Set<ClassicCollapsibleSectionId> {
  if (!storage) return defaultCollapsedSections();
  try {
    const parsed: unknown = JSON.parse(
      storage.getItem(CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY) ?? 'null',
    );
    if (!Array.isArray(parsed)) return defaultCollapsedSections();
    return new Set(parsed.filter(
      (value): value is ClassicCollapsibleSectionId => (
        typeof value === 'string' && SECTION_ID_SET.has(value)
      ),
    ));
  } catch {
    return defaultCollapsedSections();
  }
}

/** Persist layout only. A blocked/full localStorage must not break the generator. */
export function writeCollapsedSections(
  storage: Pick<Storage, 'setItem'> | null,
  collapsed: ReadonlySet<ClassicCollapsibleSectionId>,
): void {
  if (!storage) return;
  try {
    storage.setItem(
      CLASSIC_COLLAPSED_SECTIONS_STORAGE_KEY,
      JSON.stringify(
        CLASSIC_COLLAPSIBLE_SECTION_IDS.filter((id) => collapsed.has(id)),
      ),
    );
  } catch {
    /* Layout preferences are optional and never affect overlay configuration. */
  }
}

export function browserLocalStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export default function ClassicCollapsibleSection({
  sectionId,
  title,
  collapsed,
  onToggle,
  className = '',
  bodyClassName = '',
  headingLevel = 'h3',
  headingId,
  children,
}: {
  sectionId: ClassicCollapsibleSectionId;
  title: string;
  collapsed: boolean;
  onToggle: (sectionId: ClassicCollapsibleSectionId) => void;
  className?: string;
  bodyClassName?: string;
  headingLevel?: 'h2' | 'h3';
  headingId?: string;
  children: ReactNode;
}) {
  const buttonId = `${sectionId}-toggle`;
  const bodyId = `${sectionId}-body`;
  const Heading = headingLevel;

  return (
    <div
      className={`form_col settings-group${className ? ` ${className}` : ''}`}
      data-collapsed={collapsed ? 'true' : 'false'}
    >
      <Heading id={headingId} className="col-heading settings-group-heading">
        <button
          id={buttonId}
          type="button"
          className="settings-group-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          onClick={() => onToggle(sectionId)}
        >
          <span>{title}</span>
          <span className="settings-group-chevron" aria-hidden="true">›</span>
        </button>
      </Heading>
      <div
        id={bodyId}
        className={`settings-group-body${bodyClassName ? ` ${bodyClassName}` : ''}`}
        role="region"
        aria-labelledby={buttonId}
        hidden={collapsed}
      >
        {children}
      </div>
    </div>
  );
}
