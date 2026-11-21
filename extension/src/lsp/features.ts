import type * as monaco from "monaco-editor";
import type { ServerCapabilities } from "vscode-languageserver-protocol";

export const LSP_FEATURES = [
  "completion",
  "hover",
  "signatureHelp",
  "definition",
  "references",
  "rename",
  "formatting",
  "rangeFormatting",
  "codeAction",
  "inlayHint",
  "semanticTokens"
] as const;

export type LspFeature = (typeof LSP_FEATURES)[number];

export interface SessionProgress {
  readonly token: string | number;
  readonly kind: "begin" | "report" | "end";
  readonly title?: string;
  readonly message?: string;
  readonly percentage?: number;
}

export type SessionStatus =
  | { readonly kind: "initialized"; readonly serverName?: string }
  | { readonly kind: "ready" }
  | { readonly kind: "closed"; readonly message: string }
  | { readonly kind: "error"; readonly message: string }
  | {
      readonly kind: "features-unavailable";
      readonly source: "backend" | "host";
      readonly features: readonly LspFeature[];
    }
  | { readonly kind: "progress"; readonly progress: SessionProgress }
  | { readonly kind: "registration"; readonly method: string }
  | {
      readonly kind: "message";
      readonly level: "error" | "warning" | "info";
      readonly message: string;
    };

/**
 * Availability derived from the server's InitializeResult. A provider with
 * no corresponding capability is never registered as an empty provider.
 */
export function backendFeatureAvailability(
  capabilities: ServerCapabilities
): Readonly<Record<LspFeature, boolean>> {
  const semanticTokens = capabilities.semanticTokensProvider;
  const full = semanticTokens?.full;
  const codeAction = capabilities.codeActionProvider;
  const signature = capabilities.signatureHelpProvider;
  return {
    completion: capabilities.completionProvider != null,
    hover: capabilities.hoverProvider != null,
    signatureHelp: signature != null,
    definition: capabilities.definitionProvider != null,
    references: capabilities.referencesProvider != null,
    rename: capabilities.renameProvider != null,
    formatting: capabilities.documentFormattingProvider != null,
    rangeFormatting: capabilities.documentRangeFormattingProvider != null,
    codeAction: codeAction != null,
    inlayHint: capabilities.inlayHintProvider != null,
    semanticTokens:
      semanticTokens != null &&
      (full === true || (typeof full === "object" && full !== null))
  };
}

export function missingBackendFeatures(
  capabilities: ServerCapabilities
): readonly LspFeature[] {
  const availability = backendFeatureAvailability(capabilities);
  return LSP_FEATURES.filter((feature) => !availability[feature]);
}

/**
 * Provider APIs live on monaco.languages in 0.57; retained site builds may be
 * older and lack some entry points. Detection is deliberately limited to
 * public APIs, never private fields.
 */
export function hostFeatureAvailability(
  monacoApi: typeof monaco
): Readonly<Record<LspFeature, boolean>> {
  const languages = monacoApi.languages as unknown as Record<string, unknown>;
  const available = (name: string): boolean =>
    typeof languages[name] === "function";
  return {
    completion: available("registerCompletionItemProvider"),
    hover: available("registerHoverProvider"),
    signatureHelp: available("registerSignatureHelpProvider"),
    definition: available("registerDefinitionProvider"),
    references: available("registerReferenceProvider"),
    rename: available("registerRenameProvider"),
    formatting: available("registerDocumentFormattingEditProvider"),
    rangeFormatting: available("registerDocumentRangeFormattingEditProvider"),
    codeAction: available("registerCodeActionProvider"),
    inlayHint: available("registerInlayHintsProvider"),
    semanticTokens: available("registerDocumentSemanticTokensProvider")
  };
}

export function missingHostFeatures(
  monacoApi: typeof monaco,
  backendAvailable: Readonly<Record<LspFeature, boolean>>
): readonly LspFeature[] {
  const host = hostFeatureAvailability(monacoApi);
  return LSP_FEATURES.filter(
    (feature) => backendAvailable[feature] && !host[feature]
  );
}
