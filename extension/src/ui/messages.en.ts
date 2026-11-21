/*
 * English message table.
 *
 * Every UI-visible string lives here or in messages.zh-CN.ts. The build checks
 * that both tables expose exactly the same keys; tests cover the comparator.
 */
export const messages = {
  "common.appName": "MonacoAnywhere",
  "common.confirm": "Confirm",
  "common.dismiss": "Dismiss",
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
  "editor.heading": "MonacoAnywhere {version} · {mode} playground",
  "editor.headingSuffix": "playground",
  "editor.ariaLabel": "MonacoAnywhere C++ editor with local draft recovery",
  "editor.status.initial":
    "Editor ready. Drafts stay on this device; C++ services use your selected backend.",
  "editor.standalone.ready": "Blank C++ workspace",
  "editor.status.bootstrap":
    "Language services aren't included in this bootstrap build. Editing and local drafts still work.",
  "editor.status.production":
    "C++ language services aren't running yet. Choose a backend in setup to enable them.",
  "editor.status.noCpp":
    "C++ syntax highlighting failed to load. Editing and local drafts still work.",
  "editor.status.badTheme":
    "Couldn't apply theme '{theme}': {error}. Using the default theme instead.",
  "editor.status.settingsError":
    "Couldn't read settings: {error}. Using defaults for now; check the selected backend in options.",
  "editor.status.lspNotConfigured":
    "Choose a backend in setup to enable C++ completion and diagnostics.",
  "editor.status.lspConnecting":
    "Starting C++ language service and preparing headers…",
  "editor.status.lspReady": "C++ services ready",
  "editor.status.lspReconnecting":
    "Language service disconnected. Reconnecting ({attempt}/{max})…",
  "editor.status.lspClosedFinal":
    "Language service stopped repeatedly: {reason}. Reopen the editor to retry.",
  "editor.status.lspError":
    "C++ language service stopped: {error}. Editing and local drafts still work.",
  "editor.status.lspPaused":
    "WASM language service paused while this tab is hidden. It will resume when you return.",
  "editor.status.lspUnavailable":
    "Couldn't read backend settings: {error}. Editing and local drafts still work.",
  "editor.status.dataMissing":
    "Toolchain data unavailable: {error}. Editing and local drafts still work.",
  "editor.draft.scopeAnon":
    "Anonymous draft — saved only on this device.",
  "editor.draft.saved": "Saved locally at {time}.",
  "editor.draft.unchanged":
    "Draft is already up to date.",
  "editor.draft.restored": "Local draft restored.",
  "editor.draft.discarded":
    "Kept default text. Your saved draft won't be replaced until you edit.",
  "editor.draft.saveError": "Couldn't save local draft: {error}",
  "editor.draft.loadError":
    "Couldn't read local draft storage: {error}. Autosave is paused—retry before closing this tab.",
  "editor.draft.restoreTitle": "Restore local draft?",
  "editor.draft.restoreBody":
    "A local draft was saved at {time}. Restoring replaces the current text; keeping the default text preserves your saved draft until you edit.",
  "editor.draft.restore": "Restore draft",
  "editor.draft.useFixture": "Keep default text",
  "editor.draft.conflictTitle": "Draft conflict across tabs",
  "editor.draft.conflictLegend":
    "Choose which version to keep (previews are read-only)",
  "editor.draft.conflictBody":
    "This tab last saved at {thisTime}; another tab saved at {otherTime}. Choose which version to keep.",
  "editor.draft.otherActive": "The other tab is still active.",
  "editor.draft.otherInactive":
    "The other tab is no longer active.",
  "editor.draft.thisPage": "Keep this tab",
  "editor.draft.otherPage": "Keep the other tab",
  "editor.draft.keepNewer": "Keep the newer version",
  "editor.draft.newerThis": "This tab is newer.",
  "editor.draft.newerOther": "The other tab is newer.",
  "editor.draft.previewThis": "This tab",
  "editor.draft.previewOther": "Saved in another tab",
  "editor.draft.empty": "(empty)",
  "editor.draft.applyChoice": "Apply",
  "editor.draft.decideLater": "Decide later",
  "editor.draft.resolve": "Resolve conflict",
  "editor.draft.retrySave": "Retry save",
  "editor.draft.deferred":
    "Conflict unresolved. Autosave is paused until you choose a version.",
  "editor.draft.leaseLost":
    "Another tab took over autosave for this draft. Retry to save from this tab instead.",
  "editor.draft.remoteChanged":
    "Another tab updated this draft. You'll be asked before overwriting on your next save.",
  "editor.draft.conflictResolved": "Conflict resolved: {choice}.",
  "editor.draft.conflictStale":
    "The other tab changed again. Review the updated comparison.",

  "editor.site.heading": "MonacoAnywhere {version} · {mode} · site editor",
  "editor.site.ariaLabel":
    "MonacoAnywhere C++ site editor with local draft recovery",
  "editor.site.waiting": "Connecting to the page editor…",
  "editor.site.standardLabel": "C++ standard",
  "editor.site.standardPlaceholder": "Choose standard",
  "editor.site.languageMissing":
    "No language selected on this site. Language services are off; editing and sync still work.",
  "editor.site.languageUnknown":
    "Site language “{label}” doesn't match a supported C++ standard. Language services are off; editing and sync still work.",
  "editor.site.languageUnsupported":
    "Site language “{label}” uses C++26, which isn't supported yet. Language services are off; editing and sync still work.",
  "editor.site.languageFallbackVersion":
    "Site language “{label}” doesn't name a C++ version. Using C++23 language services by default; editing and sync still work.",
  "editor.site.languageFallbackUnsupported":
    "Site language “{label}” selects C++26, which isn't supported yet. Using C++23 language services; some C++26 features may be missing.",
  "editor.site.languageRequested":
    "Requested {standard} from the site…",
  "editor.site.choiceTitle": "Choose compiler option",
  "editor.site.choiceBody":
    "This site has multiple compiler options for {standard}. Pick the one you want to use.",
  "editor.site.choiceLegend": "Site compiler options",
  "editor.site.choiceConfirm": "Apply option",
  "editor.site.choiceSent":
    "Applying the selected compiler option…",
  "editor.site.choiceUnavailable":
    "No selectable compiler option was found for that standard.",
  "editor.site.choiceError":
    "Couldn't load site compiler options: {error}",
  "editor.site.remoteActiveStatus":
    "This page is using the site's built-in language service. To use MonacoAnywhere instead, choose WASM or Local clangd, save your code, and reload.",
  "editor.site.remoteReloadStatus":
    "Backend choice saved. Save your code and reload the page to apply it.",
  "editor.site.remoteUnsupportedStatus":
    "Couldn't safely pause this site's language service, so MonacoAnywhere language services are off here. Editing and sync still work.",
  "editor.site.remoteSiteStatus":
    "Using this site's built-in language service. Switch to WASM or Local clangd to use MonacoAnywhere instead.",
  "editor.site.scope":
    "Draft: {account} · {problem} (stored locally)",
  "editor.site.anonymous": "anonymous",
  "editor.site.restoreBody":
    "A local draft was saved at {time}. Restoring replaces the site editor's text; keeping the site text preserves your saved draft until you edit.",
  "editor.site.useSiteText": "Keep site text",
  "editor.site.discarded":
    "Kept site text. Your saved draft won't be replaced until you edit.",
  "editor.site.textTooLarge":
    "Code exceeds the site-sync size limit and wasn't sent to the site editor.",
  "editor.site.siteTextChanged":
    "The site editor changed while you had unsent edits. Your editor text was kept—check the site editor before submitting.",

  "onboarding.pageTitle": "MonacoAnywhere setup",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "Set up MonacoAnywhere",
  "onboarding.intro":
    "Choose a backend, prepare its resources, and run a quick completion test to finish setup.",
  "onboarding.steps.ariaLabel": "Setup steps",
  "onboarding.steps.backend": "Backend",
  "onboarding.steps.resources": "Resources",
  "onboarding.steps.validation": "Validation",
  "onboarding.steps.complete": "Finish",
  "onboarding.choose.title": "Choose a backend",
  "onboarding.choose.legend": "Language-service backend",
  "onboarding.backend.wasm.title": "WASM clangd",
  "onboarding.backend.wasm.description":
    "Runs inside the browser using the bundled WASM engine and a downloadable C++ toolchain pack.",
  "onboarding.backend.native.title": "Local clangd",
  "onboarding.backend.native.description":
    "Connects to clangd installed on your computer via a separate native host.",
  "onboarding.choose.hint":
    "Pick the backend you want to use. You can change it later in options.",
  "onboarding.resources.title": "Prepare resources",
  "onboarding.resources.note":
    "Matching packs already installed are reused automatically. Downloads are verified before installation.",
  "onboarding.resources.wasmBody":
    "Downloads the C++ toolchain pack, verifies its checksum and headers, and saves it locally.",
  "onboarding.resources.nativeBody":
    "Install the native host from host/dist using this extension ID, then run detection to verify the connection.",
  "onboarding.resources.install": "Download and install toolchain pack",
  "onboarding.resources.recheck": "Check installed pack",
  "onboarding.resources.detect": "Detect native host",
  "onboarding.resources.nativeCommand": "Host install command",
  "onboarding.resources.wasmNotChecked":
    "No matching toolchain pack found. Download and install it to continue.",
  "onboarding.resources.nativeNotChecked":
    "Native host not checked yet. Click Detect native host to test the connection.",
  "onboarding.resources.checkingInstalled":
    "Checking installed toolchain packs…",
  "onboarding.resources.installingPreparing":
    "Preparing download…",
  "onboarding.resources.installing":
    "Downloading {pack}: {received} / {total} ({percent}%) · mirror {mirror}/{mirrors}…",
  "onboarding.resources.verifying":
    "Verifying {pack} before installing…",
  "onboarding.resources.installed":
    "Toolchain pack {pack} {version} is already installed ({files} files, {bytes}, SHA-256 {sha}…).",
  "onboarding.resources.installSuccess":
    "Installed {pack} {version} ({bytes}, {files} files, SHA-256 {sha}…).",
  "onboarding.resources.installRequired":
    "Install the toolchain pack before continuing to validation.",
  "onboarding.resources.allMirrorsFailed":
    "Couldn't download from any mirror. Check your connection, retry, or switch backends.",
  "onboarding.resources.checksumMismatch":
    "Downloaded files failed SHA-256 verification on every mirror. Retry or switch backends.",
  "onboarding.resources.verificationFailed":
    "Toolchain pack verification failed: {error}",
  "onboarding.resources.storageFailed":
    "Couldn't save the toolchain pack locally: {error}",
  "onboarding.resources.catalogueFailed":
    "Couldn't load the bundled toolchain catalog: {error}",
  "onboarding.resources.installFailed":
    "Toolchain pack installation failed: {error}",
  "onboarding.resources.nativeChecking": "Connecting to native host…",
  "onboarding.resources.nativeMissing":
    "Native host not found: {error}. Install it and retry, or switch backends.",
  "onboarding.resources.nativeEmpty":
    "Native host didn't return a response. You can still continue to validation to test clangd directly.",
  "onboarding.resources.nativeFailed":
    "Native host detection failed: {error}",
  "onboarding.resources.nativeResponded":
    "Native host connected ({detail}). Continue to validation to test clangd.",
  "onboarding.resources.chooseBackend":
    "Choose a backend first.",
  "onboarding.validation.title": "Validation",
  "onboarding.validation.description":
    "Starts your selected backend, initializes clangd on a sample C++ file, and sends a {method} request to verify completions work.",
  "onboarding.validation.check": "Run validation",
  "onboarding.validation.changeBackend": "Change backend",
  "onboarding.validation.readyToCheck":
    "Not run yet. Starting clangd may take a few seconds.",
  "onboarding.validation.stage.starting": "starting backend",
  "onboarding.validation.stage.initializing": "initializing clangd",
  "onboarding.validation.stage.opening": "opening sample file",
  "onboarding.validation.stage.completing": "requesting completions",
  "onboarding.validation.progress": "Validating: {stage}…",
  "onboarding.validation.success":
    "Validation passed ({count} completion items returned).",
  "onboarding.validation.zeroItems":
    "clangd returned 0 completion items. Retry or change backend.",
  "onboarding.validation.packMissing":
    "Toolchain pack {pack} {version} isn't installed. Go back to Resources to install it first.",
  "onboarding.validation.preparationFailed":
    "Couldn't prepare validation: {error}",
  "onboarding.validation.backendFailed":
    "Couldn't start the {backend} backend: {error}",
  "onboarding.validation.failed": "Validation failed: {error}",
  "onboarding.validation.markFailed":
    "Validation returned {count} items, but setup status couldn't be saved: {error}",
  "onboarding.validation.completeNote":
    "Setup finishes once clangd returns at least one completion item.",
  "onboarding.guidance.wasm.title": "WASM backend",
  "onboarding.guidance.wasm.first":
    "Runs WASM clangd inside the extension with a verified toolchain pack that provides the standard library headers.",
  "onboarding.guidance.wasm.second":
    "Installed packs are reused automatically. Validation runs a quick completion test before finishing.",
  "onboarding.guidance.native.title": "Local backend",
  "onboarding.guidance.native.first":
    "Install the native host from host/dist using this extension ID, then detect it to verify the link.",
  "onboarding.guidance.native.second":
    "Validation then starts clangd through the native host to verify C++ completions.",
  "onboarding.validation.chooseBackend":
    "Choose a backend before running validation.",
  "onboarding.error.selectBackend":
    "Select a backend to continue.",
  "onboarding.info.saved":
    "Backend saved. Complete resource setup and validation to finish.",
  "onboarding.error.save": "Couldn't save backend choice: {error}",
  "onboarding.error.openOptions": "Couldn't open options: {error}",
  "onboarding.info.completeStored":
    "Setup was completed earlier. Run validation again to finish in this session.",
  "onboarding.complete.title": "Finish setup",
  "onboarding.complete.blocked":
    "Run validation successfully before finishing setup.",
  "onboarding.complete.stored":
    "Setup was validated earlier. Run validation again to enable Finish.",
  "onboarding.complete.requirementStatus":
    "Finish unlocks once validation returns at least one completion item.",
  "onboarding.complete.requirements":
    "Setup status is saved across restarts. Switching backends later requires validating again.",
  "onboarding.complete.success":
    "Validation passed with {count} completion items. Setup status saved.",
  "onboarding.complete.ready":
    "All set. Click Finish setup to open options.",
  "onboarding.complete.finish": "Finish setup",
  "onboarding.error.init": "Setup failed to initialize: {error}",

  "options.pageTitle": "MonacoAnywhere options",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "MonacoAnywhere options",
  "options.intro":
    "Configure your backend, editor, and compiler preferences. Use the setup wizard to install toolchain packs or validate your backend.",
  "options.nav.label": "Settings sections",
  "options.back": "Back",
  "options.panel.label": "Settings",
  "options.nav.services": "Language services",
  "options.nav.services.help": "Backend and clangd path",
  "options.nav.editor": "Editor",
  "options.nav.editor.help": "Font, theme, and background pause",
  "options.nav.appearance": "Interface",
  "options.nav.appearance.help": "Theme and display language",
  "options.nav.advanced": "Advanced",
  "options.nav.advanced.help": "Local clangd compiler flags",
  "options.nav.state": "Status",
  "options.nav.state.help": "Setup status and per-site choices",
  "options.group.backend": "Backend",
  "options.group.local": "Local configuration",
  "options.group.editor": "Text editor",
  "options.group.behavior": "Behavior",
  "options.group.theme": "Appearance",
  "options.group.language": "Language",
  "options.group.compiler": "Compiler integration",
  "options.group.setup": "Setup",
  "options.group.about": "About",
  "options.backend.label": "Default backend",
  "options.backend.none": "Not selected",
  "options.backend.noneShort": "None",
  "options.backend.wasm": "WASM clangd",
  "options.backend.wasmShort": "WASM",
  "options.backend.native": "Local clangd",
  "options.backend.nativeShort": "Local",
  "options.validation.title": "Backend validation",
  "options.validation.idle":
    "Not validated yet. Starts the selected backend and requests one completion.",
  "options.validation.verified": "Validated and ready.",
  "options.validation.running": "Validating: {stage}…",
  "options.validation.success":
    "Validation passed with {count} completion items.",
  "options.validation.chooseBackend": "Select and save a backend first.",
  "options.validation.unsaved": "Save the backend selection first.",
  "options.validation.noCompletions":
    "clangd returned no completion items. Retry, or open the setup wizard.",
  "options.validation.packMissing":
    "Toolchain pack {pack} {version} isn't installed. Install it in the setup wizard first.",
  "options.validation.failed": "Validation failed: {error}",
  "options.validation.run": "Validate",
  "options.backend.help":
    "Changing the backend clears its validation state. Validate it here or in the setup wizard.",
  "options.theme.label": "Theme",
  "options.theme.system": "Follow system",
  "options.theme.light": "Light",
  "options.theme.dark": "Dark",
  "options.locale.label": "Interface language",
  "options.locale.auto": "Follow browser",
  "options.locale.zh": "简体中文",
  "options.locale.en": "English",
  "options.hiddenPause.label": "Pause when hidden (ms)",
  "options.hiddenPause.help": "Applies to active WASM sessions when a tab moves to the background.",
  "options.clangdPath.label": "clangd path",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help":
    "Passed to the native host when starting a local session; this page doesn't check the path.",
  "options.editorFont.label": "Editor font family",
  "options.editorFont.help":
    "Enter monospace to use your browser's default, or provide a CSS font stack.",
  "options.editorTheme.label": "Editor theme",
  "options.queryDriver.label": "query-driver allowlist",
  "options.queryDriver.placeholder": "One glob per line, or comma-separated",
  "options.queryDriver.help":
    "Used only by local clangd sessions.",
  "options.extraIncludes.label": "Extra include directories",
  "options.extraIncludes.placeholder":
    "One path per line, or comma-separated",
  "options.extraIncludes.help":
    "Passed as include flags to local clangd sessions.",
  "options.saveShort": "Save",
  "options.openSetup": "Open setup wizard",
  "options.error.unsupportedBackend": "Unsupported backend.",
  "options.error.pauseRange":
    "Pause delay must be a whole number between {min} and {max} ms.",
  "options.info.saved":
    "Preferences saved.",
  "options.info.backendChanged":
    "Backend saved. Validate it below to confirm the new backend.",
  "options.info.themeSaved": "Theme updated.",
  "options.info.localeSaved": "Interface language updated.",
  "options.error.preferenceSave": "Couldn't save preference: {error}",
  "options.error.save": "Couldn't save preferences: {error}",
  "options.error.openSetup": "Couldn't open setup wizard: {error}",
  "options.error.init": "Options failed to initialize: {error}",
  "options.state.none": "No backend selected. Setup is incomplete.",
  "options.state.backend":
    "Backend: {backend} · Setup complete: {complete}",
  "options.state.siteOverrides": "Per-site backend overrides: {count}",
  "options.state.overridesHelp":
    "Resetting returns those sites to their built-in language services.",
  "options.resetSites": "Reset per-site backends",
  "options.info.sitesReset": "Per-site backend choices cleared. Reload open tabs to apply.",
  "options.state.note":
    "Changing your backend resets setup status until you validate it here or in the setup wizard.",
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
  "popup.backend.none": "Not selected",
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
  "popup.remote.none": "No site service",
  "popup.theme.label": "Editor theme",
  "popup.registrations.count": "{count} sites enabled",
  "popup.oobe.incomplete":
    "Finish setup to download toolchain data and verify your backend.",
  "popup.oobe.stored":
    "Backend validated and ready.",
  "popup.continueSetup": "Continue setup",
  "popup.openOptions": "Settings",
  "popup.openFixture": "Standalone editor",
  "popup.enableSite": "Enable on {host}",
  "popup.error.enableSite": "Couldn't enable MonacoAnywhere on this site: {error}",
  "popup.error.openSetup": "Couldn't open setup: {error}",
  "popup.error.save": "Couldn't save preference: {error}",
  "popup.error.openOptions": "Couldn't open options: {error}",
  "popup.error.openFixture": "Couldn't open standalone editor: {error}",
  "popup.error.init": "Popup failed to initialize: {error}",
  "popup.loading": "Loading…"
} as const;

export type MessageKey = keyof typeof messages;
