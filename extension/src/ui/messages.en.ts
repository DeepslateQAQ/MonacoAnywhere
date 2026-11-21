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
  "editor.headingSuffix": "fixture",
  "editor.ariaLabel": "MonacoAnywhere C++ editor fixture with local draft recovery",
  "editor.status.initial":
    "Editor ready. Local drafts stay on this device; C++ language services start from the selected backend.",
  "editor.standalone.ready": "Blank C++ workspace",
  "editor.status.bootstrap":
    "Language services are unavailable in a bootstrap build because it ships no engine or toolchain data. Editing and local drafts still work.",
  "editor.status.production":
    "C++ language services have not started yet. Choose a backend in setup; editing and local drafts still work.",
  "editor.status.noCpp":
    "Syntax highlighting is unavailable because the cpp language definition did not register; editing and local drafts still work.",
  "editor.status.badTheme":
    "Could not apply editor theme '{theme}': {error}. Using the system default theme.",
  "editor.status.settingsError":
    "Could not read settings: {error}. Using defaults; check the selected backend in options.",
  "editor.status.lspNotConfigured":
    "Choose a language-service backend in setup to enable C++ completion and diagnostics.",
  "editor.status.lspConnecting":
    "Starting the C++ language service and preparing toolchain headers…",
  "editor.status.lspReady": "C++ services ready",
  "editor.status.lspReconnecting":
    "Language service disconnected. Reconnecting ({attempt}/{max})…",
  "editor.status.lspClosedFinal":
    "Language service closed repeatedly: {reason}. Your edits are safe; reopen the editor to retry.",
  "editor.status.lspError":
    "The C++ language service stopped: {error}. Editing and local drafts still work.",
  "editor.status.lspPaused":
    "The tab stayed hidden, so the WASM language service was paused. It will restart when the tab is visible again; code and drafts are kept.",
  "editor.status.lspUnavailable":
    "Could not read the backend settings: {error}. Editing and local drafts still work.",
  "editor.status.dataMissing":
    "Toolchain data is unavailable: {error}. Editing and local drafts still work.",
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

  "editor.site.heading": "MonacoAnywhere {version} · {mode} · site editor",
  "editor.site.ariaLabel":
    "MonacoAnywhere C++ editor for the site editor with local draft recovery",
  "editor.site.waiting": "Waiting for the site editor context from the page…",
  "editor.site.standardLabel": "C++ standard",
  "editor.site.standardPlaceholder": "Choose standard",
  "editor.site.languageMissing":
    "The site did not report a selected language option. Language services are off; editing and site sync still work.",
  "editor.site.languageUnknown":
    "Site language “{label}” is not mapped to a supported C++ standard. Language services are off; editing and site sync still work.",
  "editor.site.languageUnsupported":
    "Site language “{label}” is C++26, which MonacoAnywhere does not support. Language services are off; editing and site sync still work.",
  "editor.site.languageRequested":
    "Requested {standard} from the site. Waiting for its language control to apply it.",
  "editor.site.choiceTitle": "Choose the site compiler option",
  "editor.site.choiceBody":
    "The site offers more than one compiler option for {standard}. Choose the exact option to apply; nothing is selected automatically.",
  "editor.site.choiceLegend": "Site compiler options",
  "editor.site.choiceConfirm": "Apply option",
  "editor.site.choiceSent":
    "Sent the selected site compiler option; waiting for the site to confirm.",
  "editor.site.choiceUnavailable":
    "The site did not provide a selectable compiler option for that standard.",
  "editor.site.choiceError":
    "Could not show the site compiler options: {error}",
  "editor.site.remoteActiveStatus":
    "This page is running the site's language service. MonacoAnywhere keeps local language services off here; choose WASM or native clangd for this site, save your code, then reload to apply the choice.",
  "editor.site.remoteReloadStatus":
    "The language backend choice for this site is stored but not applied yet. Save your code, then reload the page.",
  "editor.site.remoteUnsupportedStatus":
    "MonacoAnywhere cannot safely detect or pause this page's language service, so local language services stay off here. Editing and site sync still work.",
  "editor.site.remoteSiteStatus":
    "This site is set to use its own language service. Local language services stay off; choose WASM or native clangd for MonacoAnywhere services.",
  "editor.site.scope":
    "Draft scope: {account} · {problem}. This stays on this device.",
  "editor.site.anonymous": "anonymous",
  "editor.site.restoreBody":
    "A local draft for this site editor was saved at {time}. Restoring replaces the current site text in this editor and sends it to the site editor. Choosing the site text keeps it until you edit. Nothing is uploaded.",
  "editor.site.useSiteText": "Use site text",
  "editor.site.discarded":
    "Site text kept. The stored draft will be replaced only after your next edit.",
  "editor.site.textTooLarge":
    "The editor text is larger than the site-sync limit; it was not sent to the site editor.",
  "editor.site.siteTextChanged":
    "The site editor text changed while this editor had unsent changes. Your editor text was kept; review the site editor before submitting.",

  "onboarding.pageTitle": "MonacoAnywhere setup",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "Set up MonacoAnywhere",
  "onboarding.intro":
    "This four-step wizard chooses a backend, downloads and verifies its resources, runs a real fixture completion, and only then completes setup. Failures never switch backends automatically.",
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
    "A matching installed pack is reused without downloading. Downloads are length-, SHA-256-, manifest-, and header-tree-verified before local installation; a failed verification installs nothing.",
  "onboarding.resources.wasmBody":
    "Downloads the toolchain pack named by the packaged catalogue, verifies its SHA-256 and unpacked manifest, then stores it locally. No language service starts in this step.",
  "onboarding.resources.nativeBody":
    "Install the native host from host/dist with this extension ID, then run detection. Detection sends a real Native Messaging request; validation separately starts a real clangd session.",
  "onboarding.resources.install": "Download and install toolchain pack",
  "onboarding.resources.recheck": "Check installed pack",
  "onboarding.resources.detect": "Detect native host",
  "onboarding.resources.nativeCommand": "Host install command",
  "onboarding.resources.wasmNotChecked":
    "No matching toolchain pack is installed. Download and verify it before continuing.",
  "onboarding.resources.nativeNotChecked":
    "The native host has not been detected yet. Select Detect native host. Validation will attempt a real clangd session.",
  "onboarding.resources.checkingInstalled":
    "Checking locally installed toolchain packs…",
  "onboarding.resources.installingPreparing":
    "Preparing the toolchain download…",
  "onboarding.resources.installing":
    "Downloading {pack}: {received} / {total} ({percent}%) from mirror {mirror}/{mirrors}…",
  "onboarding.resources.verifying":
    "Download complete for {pack}; verifying SHA-256, manifest, and header tree before install…",
  "onboarding.resources.installed":
    "Toolchain pack {pack} {version} is already installed ({files} files; {bytes}; SHA-256 {sha}…). No download was started.",
  "onboarding.resources.installSuccess":
    "Installed toolchain pack {pack} {version}: {bytes}, SHA-256 {sha}…, {files} files.",
  "onboarding.resources.installRequired":
    "Install and verify the toolchain pack before continuing to validation.",
  "onboarding.resources.allMirrorsFailed":
    "All download mirrors failed; nothing was installed. Retry, change backend, or check the network.",
  "onboarding.resources.checksumMismatch":
    "Every reachable mirror served bytes that failed SHA-256 verification; nothing was installed. Retry or change backend.",
  "onboarding.resources.verificationFailed":
    "Toolchain pack verification failed; nothing was installed: {error}",
  "onboarding.resources.storageFailed":
    "The verified toolchain pack could not be stored locally: {error}",
  "onboarding.resources.catalogueFailed":
    "The bundled toolchain catalogue is unavailable: {error}",
  "onboarding.resources.installFailed":
    "Toolchain pack installation failed: {error}",
  "onboarding.resources.nativeChecking": "Contacting the native host…",
  "onboarding.resources.nativeMissing":
    "Native host not detected: {error}. Install it and retry, or change backend.",
  "onboarding.resources.nativeEmpty":
    "The native host process returned no data, so detection is incomplete. Validation will still attempt a real session.",
  "onboarding.resources.nativeFailed":
    "Native host detection failed: {error}",
  "onboarding.resources.nativeResponded":
    "Native host responded ({detail}). Detection succeeded; continue to validation to start a real clangd session.",
  "onboarding.resources.chooseBackend":
    "Choose a backend before checking resources.",
  "onboarding.validation.title": "Validation",
  "onboarding.validation.description":
    "Validation starts the selected backend through the offscreen host, initializes clangd, opens a built-in C++ fixture, and sends one real {method} request. Setup completes only when at least one item is returned.",
  "onboarding.validation.check": "Run real fixture validation",
  "onboarding.validation.changeBackend": "Change backend",
  "onboarding.validation.readyToCheck":
    "Not run yet. This starts a real language-service session and may take several seconds.",
  "onboarding.validation.stage.starting": "starting the offscreen backend",
  "onboarding.validation.stage.initializing": "initializing clangd",
  "onboarding.validation.stage.opening": "opening the fixture document",
  "onboarding.validation.stage.completing": "requesting completions",
  "onboarding.validation.progress": "Validation in progress: {stage}…",
  "onboarding.validation.success":
    "Validation succeeded: {count} completion items returned. onboardingComplete is stored.",
  "onboarding.validation.zeroItems":
    "clangd returned 0 completion items; onboardingComplete was not written. Retry or change backend.",
  "onboarding.validation.packMissing":
    "The toolchain pack {pack} {version} is not installed. Return to Resources and install it before validating.",
  "onboarding.validation.preparationFailed":
    "Validation preparation failed: {error}",
  "onboarding.validation.backendFailed":
    "Could not start the {backend} backend: {error}",
  "onboarding.validation.failed": "Validation failed: {error}",
  "onboarding.validation.markFailed":
    "Validation returned {count} items, but completion could not be stored: {error}",
  "onboarding.validation.completeNote":
    "Only a positive fixture completion count may write onboardingComplete. Failures preserve the selected backend and never switch it automatically.",
  "onboarding.guidance.wasm.title": "WASM backend",
  "onboarding.guidance.wasm.first":
    "The WASM clangd engine runs inside the extension. The toolchain pack is downloaded from the packaged catalogue mirrors and verified before installation.",
  "onboarding.guidance.wasm.second":
    "The same pack version is reused without another download. Validation starts a real offscreen clangd session and requests fixture completions.",
  "onboarding.guidance.native.title": "Native backend",
  "onboarding.guidance.native.first":
    "Install the native host from host/dist with this extension ID. The Detect native host button sends a real Native Messaging request.",
  "onboarding.guidance.native.second":
    "Validation then starts a real clangd session through the native host. A failed validation preserves this backend choice.",
  "onboarding.validation.chooseBackend":
    "Choose a backend first. Validation cannot run yet.",
  "onboarding.error.selectBackend":
    "Select a backend before continuing. No backend is preselected.",
  "onboarding.info.saved":
    "Backend choice saved. Setup is not complete until resources are prepared and validation succeeds.",
  "onboarding.error.save": "Could not save the backend choice: {error}",
  "onboarding.error.openOptions": "Could not open options: {error}",
  "onboarding.info.completeStored":
    "onboardingComplete=true is stored from a prior successful validation. Run validation again to enable Finish in this session.",
  "onboarding.complete.title": "Finish setup",
  "onboarding.complete.blocked":
    "Setup is not complete. Run the real fixture validation successfully before finishing.",
  "onboarding.complete.stored":
    "onboardingComplete=true is stored from an earlier successful validation. Run validation again in this session to enable Finish.",
  "onboarding.complete.requirementStatus":
    "Finish becomes available only after a real fixture completion returns at least one item.",
  "onboarding.complete.requirements":
    "onboardingComplete is stored centrally and survives restarts. Changing the backend clears it until that backend is validated again.",
  "onboarding.complete.success":
    "Validation succeeded with {count} completion items. onboardingComplete is stored centrally.",
  "onboarding.complete.ready":
    "Setup complete. Finish opens options; validation failures never changed the selected backend.",
  "onboarding.complete.finish": "Finish setup",
  "onboarding.error.init": "Onboarding failed to initialise: {error}",

  "options.pageTitle": "MonacoAnywhere options",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "Options",
  "options.intro":
    "Preferences are stored centrally in settings:v1 and apply immediately where noted. Setup downloads and verifies toolchain packs and runs a real fixture validation; this page never performs validation.",
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
  "options.hiddenPause.help": "Used by WASM sessions after the engine starts.",
  "options.clangdPath.label": "clangd path",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help":
    "Passed to the native host when starting a session; not probed on this page.",
  "options.editorFont.label": "Editor font family",
  "options.editorFont.help":
    "Use monospace to follow your browser's configured monospace font, or enter a CSS font stack.",
  "options.editorTheme.label": "Editor theme",
  "options.advanced.legend": "Advanced",
  "options.queryDriver.label": "query-driver allowlist",
  "options.queryDriver.placeholder": "One glob per line or comma separated",
  "options.queryDriver.help":
    "Native-host configuration only; applied when a native session starts.",
  "options.extraIncludes.label": "Extra include directories",
  "options.extraIncludes.placeholder":
    "One path per line or comma separated",
  "options.extraIncludes.help":
    "Passed as separate compiler arguments for native sessions.",
  "options.save": "Save preferences",
  "options.openSetup": "Open setup wizard",
  "options.error.unsupportedBackend": "Unsupported backend selection.",
  "options.error.pauseRange":
    "Pause delay must be an integer between {min} and {max} ms.",
  "options.info.saved":
    "Preferences saved centrally. Backend validation is not run from this page.",
  "options.info.backendChanged":
    "Backend preference saved. The previous setup completion was cleared because the backend selection changed; complete setup again.",
  "options.info.themeSaved": "Theme saved and applied.",
  "options.info.localeSaved": "Interface language saved and applied.",
  "options.error.preferenceSave": "Could not save this preference: {error}",
  "options.error.save": "Could not save preferences: {error}",
  "options.error.openSetup": "Could not open setup: {error}",
  "options.error.init": "Options failed to initialise: {error}",
  "options.state.title": "Current state",
  "options.state.none": "No backend selected. Setup is incomplete.",
  "options.state.backend":
    "Backend preference: {backend}. onboardingComplete={complete}.",
  "options.state.siteOverrides": "Per-site backend overrides: {count}.",
  "options.resetSites": "Reset per-site backends",
  "options.info.sitesReset": "Per-site backend choices cleared. Reload open site tabs to return them to site services.",
  "options.state.note":
    "onboardingComplete is written only by a successful real fixture validation in setup, and is cleared when the backend selection changes.",
  "options.loading": "Loading preferences…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "{mode} · {version}",
  "popup.statusAria": "Status",
  "popup.state.ready": "Ready",
  "popup.state.setup": "Setup needed",
  "popup.site.label": "Current site",
  "popup.site.none": "No web page",
  "popup.backend.label": "Backend",
  "popup.backend.choose": "Default backend",
  "popup.backend.chooseSite": "Backend for this Hydro site",
  "popup.backend.none": "No backend selected",
  "popup.backend.wasm": "WASM clangd",
  "popup.backend.native": "Local clangd",
  "popup.backend.nativeShort": "Local",
  "popup.backend.site": "Site language service",
  "popup.backend.siteShort": "Site",
  "popup.services.label": "Language service",
  "popup.services.none": "Not configured",
  "popup.services.local": "MonacoAnywhere · {backend}",
  "popup.remote.active": "Site LSP running",
  "popup.remote.suspended": "Site LSP paused",
  "popup.remote.reload": "Reload required",
  "popup.remote.unsupported": "Site LSP unknown",
  "popup.remote.none": "Site service unused",
  "popup.theme.label": "Editor theme",
  "popup.registrations.count": "{count} sites registered",
  "popup.oobe.incomplete":
    "Setup is incomplete. Finish setup to download toolchain data and validate the selected backend.",
  "popup.oobe.stored":
    "The selected backend was validated successfully.",
  "popup.continueSetup": "Continue setup",
  "popup.openOptions": "Settings",
  "popup.openFixture": "Standalone editor",
  "popup.enableSite": "Enable on {host}",
  "popup.error.enableSite": "Could not enable MonacoAnywhere on this site: {error}",
  "popup.error.openSetup": "Could not open setup: {error}",
  "popup.error.save": "Could not save the preference: {error}",
  "popup.error.openOptions": "Could not open options: {error}",
  "popup.error.openFixture": "Could not open fixture: {error}",
  "popup.error.init": "Popup failed to initialise: {error}",
  "popup.loading": "Loading status…"
} as const;

export type MessageKey = keyof typeof messages;
