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

  "build.mode.bootstrap": "bootstrap",
  "build.mode.production": "production",

  "editor.pageTitle": "MonacoAnywhere editor",
  "editor.heading": "MonacoAnywhere {version} · {mode} fixture",
  "editor.ariaLabel": "MonacoAnywhere C++ editor fixture",
  "editor.status.initial": "Language services are unavailable in this build.",
  "editor.status.bootstrap":
    "Language services unavailable — bootstrap build. Editing and C++ syntax highlighting work; there is no clangd engine, data pack, or OOBE validation in this slice.",
  "editor.status.production":
    "Language services unavailable — this skeleton build has no LSP session. Editing and C++ syntax highlighting work; engine integration is not part of this slice.",
  "editor.status.noCpp":
    "Syntax highlighting is unavailable because the cpp language definition did not register; editing still works. Language services are not implemented in this build.",

  "onboarding.pageTitle": "MonacoAnywhere setup",
  "onboarding.eyebrow": "MonacoAnywhere · {mode}",
  "onboarding.title": "Set up MonacoAnywhere",
  "onboarding.intro":
    "This wizard normally chooses a language-service backend, prepares its resources, and runs a real fixture check. The current bootstrap build can only record your choice; it cannot validate a backend or finish setup.",
  "onboarding.steps.ariaLabel": "Setup steps",
  "onboarding.steps.backend": "Backend",
  "onboarding.steps.resources": "Resources",
  "onboarding.steps.validation": "Validation",
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
    "Resource download, native-host detection, and the engine are not part of this skeleton build. Nothing will be downloaded or launched here.",
  "onboarding.validation.title": "Validation",
  "onboarding.validation.description":
    "A real setup would run one {method} request against the built-in fixture and show the returned item count. This build has no clangd session, so that check is disabled.",
  "onboarding.validation.disabledButton":
    "Validation unavailable in this build",
  "onboarding.validation.initialStatus":
    "Validation is intentionally unavailable in this build.",
  "onboarding.validation.completeNote":
    "Setup is not complete and onboardingComplete is not written. You can still inspect the editor fixture and adjust preferences.",
  "onboarding.guidance.wasm.title": "WASM backend",
  "onboarding.guidance.wasm.first":
    "The WASM clangd engine and toolchain data packs are not part of this skeleton build, so no download or fixture validation is attempted.",
  "onboarding.guidance.wasm.second":
    "When the engine exists, the setup flow will download the data pack with a visible progress indicator and verify its SHA-256 before use.",
  "onboarding.guidance.native.title": "Native backend",
  "onboarding.guidance.native.first":
    "Install the native host from host/dist with this extension ID, then select the native backend in options. The host, clangd detection, and language services are not implemented in this slice.",
  "onboarding.guidance.native.second":
    "Detection is intentionally unavailable here. A future step will run the real host check and report the detected clangd version.",
  "onboarding.validation.chooseBackend":
    "Choose a backend first. Validation remains unavailable in this skeleton build.",
  "onboarding.validation.unavailable":
    "Validation is intentionally unavailable: no clangd engine or data pack is present, and no fixture request has been sent. Setup cannot be completed in this build.",
  "onboarding.error.selectBackend":
    "Select a backend before continuing. No backend is preselected.",
  "onboarding.info.saved":
    "Backend choice saved. This does not complete setup: validation is unavailable in this build.",
  "onboarding.error.save": "Could not save the backend choice: {error}",
  "onboarding.error.openOptions": "Could not open options: {error}",
  "onboarding.info.completeStored":
    "Storage reports onboardingComplete=true, but this skeleton build cannot validate it. No new completion is written.",
  "onboarding.error.init": "Onboarding failed to initialise: {error}",

  "options.pageTitle": "MonacoAnywhere options",
  "options.eyebrow": "MonacoAnywhere · {mode}",
  "options.title": "Options",
  "options.intro":
    "Preferences are stored locally. This bootstrap build has no clangd engine, no native host integration, and no fixture validation, so it does not claim that any backend works.",
  "options.services.title": "Language services and editor",
  "options.backend.label": "Backend preference",
  "options.backend.none": "No backend selected",
  "options.backend.wasm": "WASM clangd",
  "options.backend.native": "Local clangd",
  "options.backend.help":
    "Not preselected by default. Changing this does not validate it.",
  "options.theme.label": "Theme",
  "options.theme.system": "Follow system",
  "options.theme.light": "Light",
  "options.theme.dark": "Dark",
  "options.locale.label": "Interface language",
  "options.locale.auto": "Follow browser",
  "options.locale.zh": "简体中文",
  "options.locale.en": "English",
  "options.hiddenPause.label": "Hidden-tab pause (ms)",
  "options.hiddenPause.help": "Applied to WASM sessions after integration.",
  "options.clangdPath.label": "clangd path",
  "options.clangdPath.placeholder": "/usr/bin/clangd",
  "options.clangdPath.help":
    "Used by the native host once it exists; not checked here.",
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
    "Added as separate compiler arguments after integration.",
  "options.save": "Save preferences",
  "options.openSetup": "Open setup wizard",
  "options.error.unsupportedBackend": "Unsupported backend selection.",
  "options.error.pauseRange":
    "Pause delay must be an integer between {min} and {max} ms.",
  "options.info.saved":
    "Preferences saved locally. No backend was validated; OOBE remains incomplete in this build.",
  "options.error.save": "Could not save preferences: {error}",
  "options.error.openSetup": "Could not open setup: {error}",
  "options.error.init": "Options failed to initialise: {error}",
  "options.state.title": "Current state",
  "options.state.none":
    "No backend selected. Setup is incomplete and language services are unavailable in this build.",
  "options.state.backend":
    "Backend preference: {backend}. onboardingComplete={complete}. This skeleton build cannot validate either backend.",
  "options.state.note":
    "onboardingComplete is never set by this build. The WASM engine, data packs, native host, site adapters, and LSP sessions remain future work.",
  "options.loading": "Loading preferences…",

  "popup.pageTitle": "MonacoAnywhere",
  "popup.eyebrow": "Skeleton build · {mode} · {version}",
  "popup.statusAria": "Status",
  "popup.backend.label": "Backend",
  "popup.backend.none": "No backend selected",
  "popup.backend.wasm": "WASM clangd",
  "popup.backend.native": "Local clangd",
  "popup.registrations.label": "Content scripts",
  "popup.registrations.count": "{count} registered",
  "popup.oobe.incomplete":
    "Setup is incomplete. Language services are unavailable in this build.",
  "popup.oobe.stored":
    "Storage says onboardingComplete=true, but this skeleton build cannot validate it.",
  "popup.openSetup": "Open setup",
  "popup.openOptions": "Open options",
  "popup.openFixture": "Open Monaco fixture",
  "popup.error.openSetup": "Could not open setup: {error}",
  "popup.error.openOptions": "Could not open options: {error}",
  "popup.error.openFixture": "Could not open fixture: {error}",
  "popup.error.init": "Popup failed to initialise: {error}",
  "popup.loading": "Loading status…"
} as const;

export type MessageKey = keyof typeof messages;
