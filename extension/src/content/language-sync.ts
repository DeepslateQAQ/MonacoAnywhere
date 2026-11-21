/*
 * Extension standard selector <-> site language control synchronization.
 *
 * The site adapter exposes only option ids and labels. Standards are derived
 * locally from those labels (site-specific parsers plus the shared C++ marker
 * parser), so the cross-world protocol stays unchanged. Ambiguous standards
 * (multiple compilers for one C++) require an explicit user choice; the first
 * option is never selected silently.
 *
 * Writes to the site control are surrounded by a 300 ms echo-suppression
 * window; events caused by our own selection are not forwarded back to the
 * editor, so stale site events cannot start a feedback loop.
 */

import {
  resolveSiteOptions,
  type ProfileSite
} from "../profiles/builtin.js";
import { chooseProfileForStandard } from "../profiles/sync.js";
import { isStandard, type Standard } from "../profiles/types.js";
import type {
  ContentToEditor,
  LanguageOptionInfo,
  SiteCommand,
  SiteResultData
} from "../shared/site-protocol.js";

const ECHO_SUPPRESSION_MS = 300;
const MAX_OPTION_ID_LENGTH = 512;
const MAX_LABEL_LENGTH = 512;
const MAX_OPTIONS = 256;
const READ_RETRY_MS = 120;
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

export interface LanguageSyncChannel {
  request(command: SiteCommand): Promise<SiteResultData>;
  send(message: ContentToEditor): void;
  onError?(message: string): void;
  onStandardUnavailable?(standard: Standard): void;
}

interface LanguageState {
  readonly optionId: string | null;
  readonly options: readonly LanguageOptionInfo[];
}

interface PendingChoice {
  readonly standard: Standard;
  readonly optionIds: ReadonlySet<string>;
}

export function normalizeLanguageOptions(
  data: SiteResultData
): LanguageOptionInfo[] {
  const source = data.options;
  if (!Array.isArray(source)) return [];
  const seen = new Set<string>();
  const result: LanguageOptionInfo[] = [];
  for (const entry of source.slice(0, MAX_OPTIONS)) {
    if (typeof entry !== "object" || entry === null) continue;
    const record = entry as unknown as Record<string, unknown>;
    const optionId = record.optionId;
    const label = record.label;
    if (
      typeof optionId !== "string" ||
      optionId.length === 0 ||
      optionId.length > MAX_OPTION_ID_LENGTH ||
      CONTROL_CHARACTERS.test(optionId) ||
      seen.has(optionId)
    ) {
      continue;
    }
    seen.add(optionId);
    result.push({
      optionId,
      label:
        typeof label === "string" ? label.slice(0, MAX_LABEL_LENGTH) : "",
      disabled: record.disabled === true
    });
  }
  return result;
}

export function normalizeCurrentOptionId(
  data: SiteResultData
): string | null {
  return typeof data.optionId === "string" &&
    data.optionId.length > 0 &&
    data.optionId.length <= MAX_OPTION_ID_LENGTH &&
    !CONTROL_CHARACTERS.test(data.optionId)
    ? data.optionId
    : null;
}

function fingerprint(state: LanguageState): string {
  return JSON.stringify([
    state.optionId,
    state.options.map((option) => [
      option.optionId,
      option.label,
      option.disabled
    ])
  ]);
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class LanguageSync {
  private readonly slotId: string;
  private readonly site: ProfileSite;
  private readonly channel: LanguageSyncChannel;
  private state: LanguageState | null = null;
  private lastSentFingerprint: string | null = null;
  private suppressUntil = 0;
  private lastSelectedOptionId: string | null = null;
  private pendingChoice: PendingChoice | null = null;
  private refreshTimer: number | null = null;
  private writeEpoch = 0;
  private disposed = false;

  constructor(slotId: string, site: ProfileSite, channel: LanguageSyncChannel) {
    this.slotId = slotId;
    this.site = site;
    this.channel = channel;
  }

  private get live(): boolean {
    return !this.disposed;
  }

  /** Fetch options/current value and forward them to the editor when changed. */
  async refresh(force = false): Promise<void> {
    if (!this.live) return;
    const epoch = this.writeEpoch;
    let state: LanguageState;
    try {
      const [optionsData, currentData] = await Promise.all([
        this.channel.request({ kind: "language-options", slotId: this.slotId }),
        this.channel.request({ kind: "read-language", slotId: this.slotId })
      ]);
      state = {
        options: normalizeLanguageOptions(optionsData),
        optionId: normalizeCurrentOptionId(currentData)
      };
    } catch (error) {
      if (this.live) {
        this.channel.onError?.(
          `Could not read the site language control: ${errorText(error)}`
        );
      }
      return;
    }
    if (!this.live || epoch !== this.writeEpoch) return;
    this.state = state;
    const nextFingerprint = fingerprint(state);
    if (!force && nextFingerprint === this.lastSentFingerprint) return;
    this.lastSentFingerprint = nextFingerprint;
    this.channel.send({
      __ma: 1,
      type: "ma/language-options",
      optionId: state.optionId,
      options: [...state.options]
    });
  }

  /**
   * A standard was chosen in the extension toolbar. One enabled option is
   * selected immediately; several options open an explicit choice dialog; no
   * option leaves the site control untouched and reports the limitation.
   */
  async handleStandard(rawStandard: string): Promise<void> {
    if (!this.live) return;
    if (!isStandard(rawStandard)) {
      this.channel.onError?.(`Unsupported C++ standard request: ${rawStandard.slice(0, 32)}`);
      return;
    }
    this.writeEpoch += 1;
    const epoch = this.writeEpoch;
    const standard = rawStandard;
    const state = await this.readFreshState();
    if (!state || !this.live || epoch !== this.writeEpoch) return;

    const resolution = resolveSiteOptions(this.site, state.options);
    const match = chooseProfileForStandard(resolution.profiles, standard);
    if (match.kind === "none") {
      this.pendingChoice = null;
      this.channel.onStandardUnavailable?.(standard);
      await this.refresh(true);
      return;
    }

    const matchedProfiles =
      match.kind === "one" ? [match.profile] : match.profiles;
    const candidates: LanguageOptionInfo[] = [];
    const seen = new Set<string>();
    for (const profile of matchedProfiles) {
      const option = state.options.find(
        (candidate) => candidate.optionId === profile.optionId
      );
      if (!option || seen.has(option.optionId)) continue;
      seen.add(option.optionId);
      candidates.push(option);
    }

    const enabled = candidates.filter((option) => !option.disabled);
    if (enabled.length === 0) {
      this.pendingChoice = null;
      this.channel.onStandardUnavailable?.(standard);
      await this.refresh(true);
      return;
    }
    if (enabled.length === 1) {
      this.pendingChoice = null;
      await this.selectAndPublish(enabled[0]!.optionId);
      return;
    }

    this.pendingChoice = {
      standard,
      optionIds: new Set(candidates.map((option) => option.optionId))
    };
    this.channel.send({
      __ma: 1,
      type: "ma/language-choice",
      standard,
      options: candidates
    });
  }

  /**
   * Explicit choice from the editor dialog. Only an option that was offered for
   * the pending standard is accepted; the site control is written once, then
   * fresh options/current value are sent back.
   */
  async handleOptionChoice(rawOptionId: string): Promise<void> {
    if (!this.live) return;
    const optionId = rawOptionId.slice(0, MAX_OPTION_ID_LENGTH);
    if (!this.pendingChoice || optionId.length === 0) return;
    if (!this.pendingChoice.optionIds.has(optionId)) return;
    this.writeEpoch += 1;
    const epoch = this.writeEpoch;
    const state = await this.readFreshState();
    if (!state || !this.live || epoch !== this.writeEpoch) return;
    const option = state.options.find(
      (candidate) => candidate.optionId === optionId
    );
    if (!option) {
      this.channel.onError?.(
        "The chosen compiler option is no longer available on this page."
      );
      return;
    }
    if (option.disabled) {
      this.channel.onError?.("The chosen compiler option is disabled on this page.");
      return;
    }
    this.pendingChoice = null;
    await this.selectAndPublish(optionId);
  }

  /** The site's own control changed. Echoes of extension writes are ignored. */
  handleNativeChange(rawOptionId: string | null): void {
    if (!this.live) return;
    const optionId =
      typeof rawOptionId === "string" &&
      rawOptionId.length > 0 &&
      rawOptionId.length <= MAX_OPTION_ID_LENGTH
        ? rawOptionId
        : null;
    if (Date.now() < this.suppressUntil && optionId === this.lastSelectedOptionId) {
      return;
    }
    this.writeEpoch += 1;
    if (this.state) {
      this.state = { ...this.state, optionId };
    }
    this.queueRefresh();
  }

  dispose(): void {
    this.disposed = true;
    this.pendingChoice = null;
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }
  }

  private queueRefresh(): void {
    if (this.refreshTimer !== null) {
      window.clearTimeout(this.refreshTimer);
    }
    this.refreshTimer = window.setTimeout(() => {
      this.refreshTimer = null;
      void this.refresh(false);
    }, 50);
  }

  private async readFreshState(): Promise<LanguageState | null> {
    try {
      const [optionsData, currentData] = await Promise.all([
        this.channel.request({ kind: "language-options", slotId: this.slotId }),
        this.channel.request({ kind: "read-language", slotId: this.slotId })
      ]);
      const state: LanguageState = {
        options: normalizeLanguageOptions(optionsData),
        optionId: normalizeCurrentOptionId(currentData)
      };
      this.state = state;
      return state;
    } catch (error) {
      if (this.live) {
        this.channel.onError?.(
          `Could not read the site language control: ${errorText(error)}`
        );
      }
      return null;
    }
  }

  private async selectAndPublish(optionId: string): Promise<void> {
    if (!this.live) return;
    if (this.state?.optionId === optionId) {
      this.lastSelectedOptionId = optionId;
      await this.refresh(true);
      return;
    }

    this.writeEpoch += 1;
    const epoch = this.writeEpoch;
    this.lastSelectedOptionId = optionId;
    this.suppressUntil = Date.now() + ECHO_SUPPRESSION_MS;
    try {
      await this.channel.request({
        kind: "select-language",
        slotId: this.slotId,
        optionId
      });
    } catch (error) {
      this.suppressUntil = 0;
      this.lastSelectedOptionId = null;
      if (this.live) {
        this.channel.onError?.(
          `Could not change the site language control: ${errorText(error)}`
        );
      }
      return;
    }
    if (!this.live || epoch !== this.writeEpoch) return;
    this.suppressUntil = Date.now() + ECHO_SUPPRESSION_MS;

    // Some controls update their value asynchronously (select2 widgets). One
    // short retry keeps the editor from showing a stale value without guessing.
    let state = await this.readFreshState();
    if (state && state.optionId !== optionId && this.live) {
      const { promise, resolve } = Promise.withResolvers<void>();
      setTimeout(resolve, READ_RETRY_MS);
      await promise;
      state = await this.readFreshState();
    }
    if (!this.live || epoch !== this.writeEpoch) return;
    await this.refresh(true);
  }
}
