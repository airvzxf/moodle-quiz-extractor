// src/permissions/asset-permissions.ts
//
// Helper to request the additional `host_permissions` needed to fetch
// authenticated `pluginfile.php` assets on the Moodle origin where the
// quiz attempt lives. This is the opt-in path documented in
// `docs/ARCHITECTURE.md` §Principios #7: "Permiso mínimo — acceso por
// origen solicitado por acción del usuario".
//
// We never request `<all_urls>` at runtime; we ask for exactly the origin
// of the page that the user is currently looking at (e.g.
// `https://moodle.example/*`). When the user clicks "Descargar ZIP" the
// browser prompts once and, if granted, fetches proceed with the existing
// Moodle session cookie automatically.

export interface BrowserApi {
  permissions?: {
    contains?: (p: { origins?: string[] }) => Promise<boolean>;
    request?: (p: { origins: string[] }) => Promise<boolean>;
  };
}

export interface PermissionRequest {
  readonly originPattern: string;
  readonly alreadyGranted: boolean;
  readonly granted: boolean;
  readonly skipped: boolean;
}

const NO_BROWSER: PermissionRequest = {
  originPattern: '',
  alreadyGranted: false,
  granted: false,
  skipped: true,
};

/** Resolve the `<origin>/*` pattern for the given URL. */
export function originPatternFor(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/*`;
  } catch {
    return '';
  }
}

/** Returns a description of whether the runtime can grant the asset fetch
 *  permission. Caller decides whether to invoke the prompt. */
export async function probeAssetPermission(
  pageUrl: string,
  api: BrowserApi,
): Promise<PermissionRequest> {
  const originPattern = originPatternFor(pageUrl);
  if (!originPattern || !api.permissions?.contains) return NO_BROWSER;
  const alreadyGranted = await api.permissions.contains({ origins: [originPattern] });
  return {
    originPattern,
    alreadyGranted,
    granted: alreadyGranted,
    skipped: true,
  };
}

/** Ask the user to grant access to the page origin so the AssetFetchClient
 *  can pull `pluginfile.php` resources. Resolves to the granted flag. */
export async function requestAssetPermission(
  pageUrl: string,
  api: BrowserApi,
): Promise<PermissionRequest> {
  const originPattern = originPatternFor(pageUrl);
  if (!originPattern) return NO_BROWSER;
  if (!api.permissions?.request) {
    return {
      originPattern,
      alreadyGranted: false,
      granted: false,
      skipped: true,
    };
  }
  const granted = await api.permissions.request({ origins: [originPattern] });
  return {
    originPattern,
    alreadyGranted: granted,
    granted,
    skipped: false,
  };
}