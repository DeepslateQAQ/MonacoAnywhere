/*
 * Dedicated-site and editor-page detection.
 *
 * This module is deliberately pure: it reads only the URL and a Document. Both
 * the ISOLATED router and the MAIN-world adapter host import it, so it must not
 * touch chrome APIs or page state. A site is only treated as supported when the
 * current location is one of the editor surfaces listed in the approved plan;
 * read-only statements, posts, and markdown editors are never taken over.
 */

import type { SiteId } from "../shared/site-protocol.js";

export type DedicatedSiteId = Exclude<SiteId, "generic">;

export interface EditorPage {
  readonly site: DedicatedSiteId;
  /**
   * Site identity used for settings and draft isolation. Hydro deployments with
   * a domain prefix use `${origin}/d/:domainId`; everything else uses origin.
   */
  readonly originKey: string;
  /** Location signature used to detect SPA route changes. */
  readonly routeKey: string;
}

function hostMatches(hostname: string, domain: string): boolean {
  return hostname === domain || hostname.endsWith(`.${domain}`);
}

/**
 * Which dedicated adapter owns this document. Generic sites are intentionally
 * not auto-detected; they require an explicit user-created rule.
 */
export function detectSite(url: URL, doc: Document): SiteId {
  if (doc.documentElement.dataset.app === "Hydro") {
    return "hydro";
  }
  if (hostMatches(url.hostname, "luogu.com.cn") || hostMatches(url.hostname, "luogu.org")) {
    return "luogu";
  }
  if (hostMatches(url.hostname, "atcoder.jp")) {
    return "atcoder";
  }
  if (hostMatches(url.hostname, "codeforces.com")) {
    return "codeforces";
  }
  if (hostMatches(url.hostname, "hydro.ac")) {
    return "hydro";
  }
  return "generic";
}

const LUOGU_PROBLEM_PATH = /(?:^|\/)problem\/[^/]+/;

function isLuoguEditor(pathname: string, hash: string): boolean {
  if (!LUOGU_PROBLEM_PATH.test(pathname)) {
    return false;
  }
  const tab = hash.startsWith("#") ? hash.slice(1) : hash;
  return tab === "submit" || tab === "ide";
}

const ATCODER_EDITOR_PATH = /^\/contests\/[^/]+\/(?:submit|custom_test)\/?$/;

const CODEFORCES_EDITOR_PATH =
  /^(?:\/problemset\/|\/(?:contest|gym)\/[^/]+\/|\/group\/[^/]+\/contest\/[^/]+\/)(?:submit|customtest)(?:\/[^/]+){0,2}\/?$/;

function hydroDomainPrefix(pathname: string): string | null {
  const match = /^\/d\/([^/]+)(?:\/|$)/.exec(pathname);
  return match?.[1] ? `/d/${match[1]}` : null;
}

const HYDRO_EDITOR_SUFFIX =
  /^(?:\/|.*\/)(?:p\/[^/]+\/(?:submit|ide)|scratchpad|ide|homework\/[^/]+)(?:\/.*)?$/;

function isHydroEditor(pathname: string, doc: Document): boolean {
  const scratchpad =
    doc.body?.classList.contains("mode--scratchpad") === true;
  if (hydroDomainPrefix(pathname) === null) {
    // Public deployments without a domain prefix are still supported when the
    // path is an explicit editor surface. Deliberately do not match bare
    // problem detail pages unless the page switched itself into the online
    // IDE (Alt+E), which keeps the URL unchanged.
    return (
      scratchpad ||
      /^\/(?:p\/[^/]+\/(?:submit|ide)|scratchpad|ide|homework\/[^/]+)(?:\/.*)?$/.test(
        pathname
      )
    );
  }
  const rest = pathname.replace(/^\/d\/[^/]+/, "");
  return scratchpad || HYDRO_EDITOR_SUFFIX.test(rest);
}

export function routeKey(url: URL): string {
  return `${url.origin}${url.pathname}${url.search}${url.hash}`;
}

/**
 * Return the editor page descriptor, or null when this document is not one of
 * the supported editor surfaces. The MAIN adapter still has to locate an
 * actual slot; a positive result here is a precondition, not proof.
 */
export function detectEditorPage(url: URL, doc: Document): EditorPage | null {
  const site = detectSite(url, doc);
  const pathname = url.pathname;
  const key = routeKey(url);

  switch (site) {
    case "luogu": {
      if (!isLuoguEditor(pathname, url.hash)) return null;
      return { site, originKey: url.origin, routeKey: key };
    }
    case "atcoder": {
      if (!ATCODER_EDITOR_PATH.test(pathname)) return null;
      return { site, originKey: url.origin, routeKey: key };
    }
    case "codeforces": {
      if (!CODEFORCES_EDITOR_PATH.test(pathname)) return null;
      return { site, originKey: url.origin, routeKey: key };
    }
    case "hydro": {
      if (!isHydroEditor(pathname, doc)) return null;
      const prefix = hydroDomainPrefix(pathname);
      const scratchpad =
        doc.body?.classList.contains("mode--scratchpad") === true;
      return {
        site,
        originKey: prefix ? `${url.origin}${prefix}` : url.origin,
        routeKey: scratchpad ? `${key}#scratchpad` : key
      };
    }
    default:
      return null;
  }
}

/**
 * Settings store keys must be HTTP(S) origin keys. Hydro domain identities add a
 * path, which is still accepted by the settings normalizer.
 */
export function isSettingsOriginKey(value: string): boolean {
  return /^https?:\/\/[^\s]+$/i.test(value);
}
