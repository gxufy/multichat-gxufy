import previewCatalog from './previewCatalog.compact.json';

import type {
  PreviewIdentityResponse,
} from './previewIdentity';

import {
  PREVIEW_ROSTER,
  rosterFeedTemplates,
  rosterTemplates,
} from './previewRoster';

const catalog =
  previewCatalog as unknown as Readonly<
    Record<string, PreviewIdentityResponse>
  >;

export const PREVIEW_CATALOG_RESPONSES =
  new Map<string, PreviewIdentityResponse>(
    PREVIEW_ROSTER.flatMap((entry) => {
      const response = catalog[entry.login];

      return response
        ? [[entry.login, response] as const]
        : [];
    }),
  );

export const PREVIEW_CATALOG_TEMPLATES =
  rosterTemplates(
    PREVIEW_CATALOG_RESPONSES,
    0,
  );

export const PREVIEW_CATALOG_FEED_TEMPLATES =
  rosterFeedTemplates(
    PREVIEW_CATALOG_RESPONSES,
    0,
  );