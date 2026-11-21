/*
 * English message table.
 *
 * Every UI-visible string lives here or in messages.zh-CN.ts. The build checks
 * that both tables expose exactly the same keys; tests cover the comparator.
 */
export const messages = {
  "common.appName": "MonacoAnywhere",
  "common.confirm": "Confirm",
  "common.cancel": "Cancel",
  "common.back": "Back",
  "common.continue": "Continue",
  "common.openOptions": "Open options",
  "common.extensionId": "Extension ID",
  "common.unavailable": "unavailable",
  "common.yes": "Yes",
  "common.no": "No",

  "build.mode.bootstrap": "bootstrap",
  "build.mode.production": "production",

  "editor.pageTitle": "MonacoAnywhere editor",
  "editor.heading": "MonacoAnywhere {version} · {mode} fixture",
  "editor.ariaLabel": "MonacoAnywhere C++ editor fixture with local draft recovery",
  "editor.status.initial":
    "Language services are unavailable in this build. Local drafts stay on this device.",
  "editor.status.bootstrap":
    "Language services unavailable — bootstrap build. Editing, C++ syntax highlighting, and local-only draft autosave work; there is no clangd engine, data pack, or OOBE validation.",
  "editor.status.production":
    "Language services unavailable — this build has no LSP session. Editing, C++ syntax highlighting, and local-only draft autosave work; engine integration is not part of this slice.",
  "editor.status.noCpp":
    "Syntax highlighting is unavailable because the cpp language definition did not register; editing and local drafts still work. Language services are not implemented in this build.",
  "editor.status.badTheme":
    "Could not apply editor theme '{theme}': {error}. Using the system default; language services remain unavailable in this build.",
  "editor.status.settingsError":
    "Could not read settings: {error}. Using defaults; language services remain unavailable.",
  "editor.draft.scopeAnon":
    "Draft scope: anonymous — this fixture page has no site account. Site editor comparison fields stay empty, and drafts are stored only on this device.",
  "editor.draft.saved": "Draft saved locally at {time}.",
  "editor.draft.unchanged":
    "Draft already matches the stored local copy; no new write was needed.",
  "editor.draft.restored": "Local draft restored. Autosave remains local only.",
  "editor.draft.discarded":
    "Fixture text kept. The stored draft will be replaced only after your next edit.",
  "editor.draft.saveError": "Could not save the local draft: {error}",
  "editor.draft.loadError":
    "Could not read local draft storage: {error}. Autosave is paused; retry before closing this tab.",
  "editor.draft.restoreTitle": "Restore local draft?",
  "editor.draft.restoreBody":
    "A local draft for this editor was saved at {time}. Restoring replaces the fixture text. Choosing the fixture keeps it until you edit. Nothing is uploaded.",
  "editor.draft.restore": "Restore draft",
  "editor.draft.useFixture": "Use fixture text",
  "editor.draft.conflictTitle": "Two tabs changed this draft",
  "editor.draft.conflictLegend":
    "Choose which copy to keep (both previews are read-only)",
  "editor.draft.conflictBody":
    "This page last saved at {thisTime}; the stored copy was updated at {otherTime}. Choose explicitly; nothing is overwritten silently.",
  "editor.draft.otherActive": "The other tab still holds an active lease.",
  "editor.draft.otherInactive":
    "No active lease; the other copy is stale and can be replaced.",
  "editor.draft.thisPage": "Use this page",
  "editor.draft.otherPage": "Use the other page",
  "editor.draft.keepNewer": "Keep the newer draft",
  "editor.draft.newerThis": "This page is newer.",
  "editor.draft.newerOther": "The other page is newer.",
  "editor.draft.previewThis": "This page",
  "editor.draft.previewOther": "Stored copy from another page",
  "editor.draft.empty": "(empty)",
  "editor.draft.applyChoice": "Apply choice",
  "editor.draft.decideLater": "Decide later",
  "editor.draft.resolve": "Resolve draft conflict",
  "editor.draft.retrySave": "Retry local save",
  "editor.draft.deferred":
    "Conflict unresolved. Autosave is paused for this draft until you choose.",
  "editor.draft.leaseLost":
    "Another tab now owns this draft's local lease. Autosave from this page is paused; retry to take it back explicitly.",
  "editor.draft.remoteChanged":
    "Another tab updated this draft. Your next save will ask before overwriting.",
  "editor.draft.conflictResolved": "Draft conflict resolved: {choice}.",
  "editor.draft.conflictStale":
    "The other copy changed again; review the refreshed comparison.",

  "onboarding.pageTitle": "MonacoAnywhere setup",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "Set up MonacoAnywhere",
  "onboarding.intro":
    "This four-step wizard chooses a backend, checks its resources, runs a real fixture validation, and only then finishes setup. This build has no data downloader, clangd session, or fixture completion client, so it cannot complete setup and never writes onboardingComplete.",
  "onboarding.steps.ariaLabel": "Setup steps",
  "onboarding.steps.backend": "Backend",
  "onboarding.steps.resources": "Resources",
  "onboarding.steps.validation": "Validation",
  "onboarding.steps.complete": "Finish",
  "onboarding.choose.title": "Choose a backend",
  "onboarding.choose.legend": "Language-service backend",
  "onboarding.backend.wasm.title": "WASM clangd",
  "onboarding.backend.wasm.description":
    "Runs in the extension. Requires a downloaded toolchain data pack and the bundled WASM engine.",
  "onboarding.backend.native.title": "Local clangd",
  "onboarding.backend.native.description":
    "Uses a separately installed native host and clangd on this computer.",
  "onboarding.choose.hint":
    "Nothing is preselected. A backend failure will never silently switch to the other backend.",
  "onboarding.resources.title": "Prepare resources",
  "onboarding.resources.note":
    "The check reads packaged build info and never downloads anything or launches a language service. Continuing does not mark resources or setup as ready.",
  "onboarding.resources.wasmBody":
    "This build has no data-download client and ships no engine or toolchain pack. The check below reports only what is packaged.",
  "onboarding.resources.nativeBody":
    "Install the native host from host/dist with this extension ID, then run detection. Detection sends a real Native Messaging request; this build ships no host or LSP session.",
  "onboarding.resources.check": "Check packaged resources",
  "onboarding.resources.detect": "Detect native host",
  "onboarding.resources.nativeCommand": "Host install command",
  "onboarding.resources.wasmNotChecked": "Resources have not been checked yet.",
  "onboarding.resources.nativeNotChecked":
    "The native host has not been detected yet. Select Detect native host.",
  "onboarding.resources.checking": "Checking packaged resources…",
  "onboarding.resources.nativeChecking": "Contacting the native host…",
  "onboarding.resources.artifact.present": "present",
  "onboarding.resources.artifact.absent": "absent",
  "onboarding.resources.downloader.missing":
    "download client not implemented",
  "onboarding.resources.wasmProbe":
    "Resources are not ready: {downloader}; packaged engine {engine}; data catalogue {catalogue}; packs {packs}. No download was attempted.",
  "onboarding.resources.nativeMissing":
    "Native host not detected: {error}. Install it and retry, or change backend. Language services and validation stay unavailable.",
  "onboarding.resources.nativeEmpty":
    "The native host process returned no data, so detection is incomplete. Nothing was validated.",
  "onboarding.resources.nativeFailed":
    "Native host detection failed: {error}",
  "onboarding.resources.nativeResponded":
    "Native host responded ({detail}). This build still has no LSP session or fixture validation client, so setup cannot complete.",
  "onboarding.resources.checkError": "Could not check resources: {error}",
  "onboarding.resources.chooseBackend":
    "Choose a backend before checking resources.",
  "onboarding.validation.title": "Validation",
  "onboarding.validation.description":
    "Validation must run one real {method} request against the built-in fixture and show the returned item count. This build has no clangd session or fixture completion client, so no request can be sent.",
  "onboarding.validation.check": "Check validation availability",
  "onboarding.validation.changeBackend": "Change backend",
  "onboarding.validation.readyToCheck":
    "Validation is expected to be unavailable. Select Check validation availability to read the real packaged prerequisites; no request will be sent.",
  "onboarding.validation.checking": "Checking validation availability…",
  "onboarding.validation.clientMissing": "not implemented",
  "onboarding.validation.unavailable":
    "Validation is unavailable for {backend}: packaged engine {engine}; fixture completion client {client}. No completion request was sent and onboardingComplete remains false.",
  "onboarding.validation.checkFailed":
    "Could not check validation availability: {error}",
  "onboarding.validation.completeNote":
    "Setup cannot complete until a real fixture validation succeeds. Your backend choice is preserved; nothing switches automatically.",
  "onboarding.guidance.wasm.title": "WASM backend",
  "onboarding.guidance.wasm.first":
    "The WASM clangd engine and toolchain data packs are not part of this integration, so no download or fixture validation is attempted.",
  "onboarding.guidance.wasm.second":
    "When the engine and downloader are integrated, the setup flow must download the data pack with a visible progress indicator and verify its SHA-256 before use.",
  "onboarding.guidance.native.title": "Native backend",
  "onboarding.guidance.native.first":
    "Install the native host from host/dist with this extension ID. The Detect native host button sends a real Native Messaging request; no LSP session is available in this build.",
  "onboarding.guidance.native.second":
    "A successful host detection does not complete setup: this build has no fixture validation client, so onboardingComplete is never written.",
  "onboarding.validation.chooseBackend":
    "Choose a backend first. Validation cannot run yet.",
  "onboarding.error.selectBackend":
    "Select a backend before continuing. No backend is preselected.",
  "onboarding.info.saved":
    "Backend choice saved. Setup is not complete: resources and validation remain unavailable in this build.",
  "onboarding.info.validationUnavailable":
    "No validation request was sent. Setup remains incomplete and onboardingComplete stays false.",
  "onboarding.info.resourceUnavailable":
    "Resource preparation is unavailable. You can inspect validation, but it cannot succeed in this build.",
  "onboarding.error.save": "Could not save the backend choice: {error}",
  "onboarding.error.openOptions": "Could not open options: {error}",
  "onboarding.info.completeStored":
    "Storage reports onboardingComplete=true, but this build cannot verify it. No new completion is written.",
  "onboarding.complete.title": "Finish setup",
  "onboarding.complete.blocked":
    "Setup is not complete. The real fixture validation has not succeeded, so onboardingComplete has not been written.",
  "onboarding.complete.stored":
    "Storage reports onboardingComplete=true, but this build cannot verify it and will not write a new completion.",
  "onboarding.complete.requirementStatus":
    "Requirements: a selected backend, prepared resources, and a successful real fixture validation.",
  "onboarding.complete.requirements":
    "This build cannot satisfy resource preparation or fixture validation. Language services remain unavailable; you can still edit and manage preferences.",
  "onboarding.complete.finish": "Finish setup",
  "onboarding.error.init": "Onboarding failed to initialise: {error}",

  "options.pageTitle": "MonacoAnywhere options",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "Options",
  "options.intro":
    "Preferences are stored centrally in settings:v1 and apply immediately where noted. This build has no clangd engine, native host integration, or fixture validation, so it does not claim that any backend works.",
  "options.services.title": "Language services and editor",
  "options.backend.label": "Backend preference",
  "options.backend.none": "No backend selected",
  "options.backend.wasm": "WASM clangd",
  "options.backend.native": "Local clangd",
  "options.backend.help":
    "No backend is preselected. Saving a backend does not validate it or mark setup complete.",
  "options.theme.label": "Theme",
  "options.theme.system": "Follow system",
  "options.theme.light": "Light",
  "options.theme.dark": "Dark",
  "options.locale.label": "Interface language",
  "options.locale.auto": "Follow browser",
  "options.locale.zh": "简体中文",
  "options.locale.en": "English",
  "options.hiddenPause.label": "Hidden-tab pause (ms)",
  "options.hiddenPause.help": "Used by WASM sessions after engine integration.",
  "options.clangdPath.label": "clangd path",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help":
    "Used by the native host once integrated; not checked here.",
  "options.editorFont.label": "Editor font family",
  "options.editorTheme.label": "Editor theme",
  "options.advanced.legend": "Advanced",
  "options.queryDriver.label": "query-driver allowlist",
  "options.queryDriver.placeholder": "One glob per line or comma separated",
  "options.queryDriver.help":
    "Native-host configuration only. Not applied by this build.",
  "options.extraIncludes.label": "Extra include directories",
  "options.extraIncludes.placeholder":
    "One path per line or comma separated",
  "options.extraIncludes.help":
    "Passed as separate compiler arguments after integration.",
  "options.save": "Save preferences",
  "options.openSetup": "Open setup wizard",
  "options.error.unsupportedBackend": "Unsupported backend selection.",
  "options.error.pauseRange":
    "Pause delay must be an integer between {min} and {max} ms.",
  "options.info.saved":
    "Preferences saved centrally. No backend was validated; setup completion is unchanged.",
  "options.info.backendChanged":
    "Backend preference saved. The previous setup completion was cleared because the backend selection changed; complete setup again.",
  "options.info.themeSaved": "Theme saved and applied.",
  "options.info.localeSaved": "Interface language saved and applied.",
  "options.error.preferenceSave": "Could not save this preference: {error}",
  "options.error.save": "Could not save preferences: {error}",
  "options.error.openSetup": "Could not open setup: {error}",
  "options.error.init": "Options failed to initialise: {error}",
  "options.state.title": "Current state",
  "options.state.none":
    "No backend selected. Setup is incomplete, validation is unavailable, and language services are not implemented in this build.",
  "options.state.backend":
    "Backend preference: {backend}. onboardingComplete={complete}. This build does not validate the backend.",
  "options.state.siteOverrides": "Per-site backend overrides: {count}.",
  "options.state.note":
    "onboardingComplete is only written by a successful real fixture validation, which this build does not implement. The WASM engine, data packs, native host, site adapters, and LSP sessions remain future work.",
  "options.loading": "Loading preferences…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "MonacoAnywhere · {mode} · {version}",
  "popup.statusAria": "Status",
  "popup.backend.label": "Backend",
  "popup.backend.none": "No backend selected",
  "popup.backend.wasm": "WASM clangd",
  "popup.backend.native": "Local clangd",
  "popup.services.label": "Language services",
  "popup.services.unavailable": "Unavailable in this build",
  "popup.registrations.label": "Content scripts",
  "popup.registrations.count": "{count} registered",
  "popup.oobe.incomplete":
    "Setup is incomplete. Finish setup when validation becomes available; validation is unavailable in this build.",
  "popup.oobe.stored":
    "onboardingComplete=true is stored, but this build did not verify it.",
  "popup.continueSetup": "Continue setup",
  "popup.openSetup": "Open setup wizard",
  "popup.openOptions": "Open options",
  "popup.openFixture": "Open Monaco fixture",
  "popup.error.openSetup": "Could not open setup: {error}",
  "popup.error.openOptions": "Could not open options: {error}",
  "popup.error.openFixture": "Could not open fixture: {error}",
  "popup.error.init": "Popup failed to initialise: {error}",
  "popup.loading": "Loading status…"
} as const;

export type MessageKey = keyof typeof messages;
