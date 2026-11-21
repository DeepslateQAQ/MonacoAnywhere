/*
 * One language-service session for one writable editor/model.
 *
 * The transport carries decoded JSON-RPC objects. This module alone owns
 * document synchronization, request cancellation, server-initiated requests,
 * diagnostics, configuration, and disposal for both WASM and native backends.
 */

import { createProtocolConnection } from "vscode-languageserver-protocol/browser";
import type { ProtocolConnection } from "vscode-languageserver-protocol/browser";
import type { CancellationToken } from "vscode-jsonrpc/browser";
import type {
  ApplyWorkspaceEditParams,
  ApplyWorkspaceEditResult,
  ClientCapabilities,
  ConfigurationParams,
  InitializeParams,
  InitializeResult,
  PublishDiagnosticsParams,
  RegistrationParams,
  ServerCapabilities
} from "vscode-languageserver-protocol";
import type * as monaco from "monaco-editor";

import {
  buildCompileCommand,
  remapCompileCommand,
  type CompileCommand,
  type CompileEngine
} from "../profiles/commands.js";
import type { CompilerProfile } from "../profiles/types.js";
import type { Backend } from "./backend.js";
import { toMonacoDiagnosticMarker } from "./conversions.js";
import {
  backendFeatureAvailability,
  missingBackendFeatures,
  type LspFeature,
  type SessionProgress,
  type SessionStatus
} from "./features.js";
import { BackendMessageReader, BackendMessageWriter } from "./transport.js";
import {
  applyWorkspaceEdit,
  type WorkspaceEditContext
} from "./workspace-edit.js";

export type MonacoApi = typeof monaco;

export interface SessionCancellationToken {
  readonly isCancellationRequested: boolean;
  onCancellationRequested(listener: () => unknown): { dispose(): void };
}

export interface SessionOptions {
  readonly backend: Backend;
  readonly monaco: MonacoApi;
  readonly profile: CompilerProfile;
  readonly engine?: CompileEngine;
  readonly generation: number;
  /** Parent generation guard; false makes every provider/request stale. */
  readonly isCurrent?: () => boolean;
  readonly onStatus?: (status: SessionStatus) => void;
}

export interface SessionBinding {
  readonly editor: monaco.editor.ICodeEditor;
  readonly model: monaco.editor.ITextModel;
  readonly uri: string;
  readonly lspVersion: number;
  readonly monacoVersionAtSync: number;
  readonly generation: number;
}

interface ActiveBinding extends SessionBinding {
  lspVersion: number;
  monacoVersionAtSync: number;
  readonly contentListener: monaco.IDisposable;
}

export class SessionStaleError extends Error {
  constructor(message = "The language session is no longer current") {
    super(message);
    this.name = "SessionStaleError";
  }
}

export class Session {
  readonly id: string;
  readonly generation: number;
  readonly uri: string;
  readonly workspaceUri: string;
  readonly filePath: string;
  readonly directory: string;
  readonly profile: CompilerProfile;
  readonly compileCommand: CompileCommand;
  readonly owner: string;

  private readonly backend: Backend;
  private readonly monacoApi: MonacoApi;
  private readonly optionsIsCurrent?: () => boolean;
  private readonly onStatus?: (status: SessionStatus) => void;
  private readonly connection: ProtocolConnection;
  private unsubscribeBackendClose: (() => void) | null = null;
  private activeBinding: ActiveBinding | null = null;
  private serverCapabilities: ServerCapabilities = {};
  private serverInfo: InitializeResult["serverInfo"] | undefined;
  private disposed = false;
  private closed = false;
  private closing: Promise<void> | null = null;
  private readonly registrations = new Map<string, string>();

  constructor(options: SessionOptions) {
    this.backend = options.backend;
    this.monacoApi = options.monaco;
    this.optionsIsCurrent = options.isCurrent;
    this.onStatus = options.onStatus;
    this.profile = options.profile;
    this.generation = options.generation;
    this.id = `ma-${options.generation}`;
    this.owner = `ma:${this.id}`;

    const workspaceRoot = `/workspace/ma-${options.generation}`;
    const baseCommand = buildCompileCommand(options.profile, options.engine);
    this.filePath = `${workspaceRoot}/main.cpp`;
    this.directory = workspaceRoot;
    this.compileCommand = remapCompileCommand(
      baseCommand,
      this.filePath,
      workspaceRoot
    );
    this.uri = fileUri(this.filePath);
    this.workspaceUri = fileUri(workspaceRoot);

    const reader = new BackendMessageReader(options.backend);
    const writer = new BackendMessageWriter(options.backend);
    this.connection = createProtocolConnection(reader, writer);
    this.installHandlers();
    this.connection.listen();
    this.unsubscribeBackendClose = options.backend.onClose((reason) => {
      this.handleTransportClosed(reason);
    });
    this.connection.onClose(() => {
      this.handleTransportClosed("The language connection closed.");
    });
    this.connection.onError(([error]) => {
      this.emitStatus({
        kind: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    });
  }

  get capabilities(): ServerCapabilities {
    return this.serverCapabilities;
  }

  get info(): InitializeResult["serverInfo"] | undefined {
    return this.serverInfo;
  }

  isCurrent(): boolean {
    if (this.disposed || this.closed || this.closing) return false;
    return this.optionsIsCurrent ? this.optionsIsCurrent() : true;
  }

  isBoundModel(model: monaco.editor.ITextModel): boolean {
    return this.activeBinding?.model === model;
  }

  isBoundUri(uri: string): boolean {
    return this.uri === uri;
  }

  getBinding(): SessionBinding | null {
    const active = this.activeBinding;
    if (!active) return null;
    return {
      editor: active.editor,
      model: active.model,
      uri: active.uri,
      lspVersion: active.lspVersion,
      monacoVersionAtSync: active.monacoVersionAtSync,
      generation: active.generation
    };
  }

  /**
   * Bind one writable editor/model. Re-calling with a different model closes
   * the previous LSP text document first and starts the new one at version 1
   * while recording the model's real Monaco version for versioned edits.
   */
  bind(
    editor: monaco.editor.ICodeEditor,
    model: monaco.editor.ITextModel
  ): SessionBinding {
    this.assertUsable();
    if (model.isDisposed()) {
      throw new SessionStaleError("Cannot bind a disposed model");
    }
    if (editor.getModel() !== model) {
      throw new Error("The editor is not attached to the model being bound");
    }
    const active = this.activeBinding;
    if (active?.model === model) {
      if (active.editor !== editor) {
        const updated = { ...active, editor };
        this.activeBinding = updated;
        return this.snapshot(updated);
      }
      return this.snapshot(active);
    }
    if (active) this.detachBinding(true);

    const listener = model.onDidChangeContent(() => {
      this.handleModelChanged(model);
    });
    const binding: ActiveBinding = {
      editor,
      model,
      uri: this.uri,
      lspVersion: 1,
      monacoVersionAtSync: model.getVersionId(),
      generation: this.generation,
      contentListener: listener
    };
    this.activeBinding = binding;
    this.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: this.uri,
        languageId: "cpp",
        version: binding.lspVersion,
        text: model.getValue()
      }
    });
    return this.snapshot(binding);
  }

  /** Detach the current writable document; safe to call when unbound. */
  unbind(): void {
    this.detachBinding(true);
  }

  async request<T = unknown>(
    method: string,
    params?: unknown,
    token?: SessionCancellationToken
  ): Promise<T> {
    this.assertUsable();
    const cancellation = token as CancellationToken | undefined;
    const result =
      params === undefined
        ? await this.connection.sendRequest<T>(method, cancellation)
        : await this.connection.sendRequest<T>(method, params, cancellation);
    if (!this.isCurrent()) {
      throw new SessionStaleError();
    }
    return result;
  }

  async notify(method: string, params?: unknown): Promise<void> {
    this.assertUsable();
    if (params === undefined) {
      await this.connection.sendNotification(method);
    } else {
      await this.connection.sendNotification(method, params);
    }
  }

  async readFile(uri: string): Promise<string | null> {
    if (this.disposed || this.closed) return null;
    if (typeof uri !== "string" || !uri.startsWith("file:")) return null;
    if (!this.backend.readFile) return null;
    try {
      return await this.backend.readFile(uri);
    } catch {
      return null;
    }
  }

  reportUnavailable(
    features: readonly LspFeature[],
    source: "backend" | "host"
  ): void {
    if (features.length === 0) return;
    this.emitStatus({
      kind: "features-unavailable",
      source,
      features: [...features]
    });
  }

  async start(): Promise<void> {
    try {
      const result = await this.connection.sendRequest<InitializeResult>(
        "initialize",
        this.initializeParams()
      );
      this.serverCapabilities = result.capabilities ?? {};
      this.serverInfo = result.serverInfo;
      const encoding = this.serverCapabilities.positionEncoding;
      if (encoding !== undefined && encoding !== "utf-16") {
        throw new Error(
          `The language server negotiated unsupported position encoding ${encoding}.`
        );
      }
      await this.connection.sendNotification("initialized", {});
      await this.sendConfiguration();
      this.emitStatus({
        kind: "initialized",
        ...(result.serverInfo?.name === undefined
          ? {}
          : { serverName: result.serverInfo.name })
      });
      this.emitStatus({ kind: "ready" });
      this.reportUnavailable(
        missingBackendFeatures(this.serverCapabilities),
        "backend"
      );
    } catch (error) {
      await this.closeAfterFailedStart();
      throw error;
    }
  }

  async dispose(): Promise<void> {
    if (this.closing) return this.closing;
    if (this.closed) {
      await this.backend.dispose().catch(() => undefined);
      return;
    }
    this.closing = this.disposeInternal();
    return this.closing;
  }

  private async disposeInternal(): Promise<void> {
    this.detachBinding(true);
    this.clearAllRegisteredState();
    try {
      await withTimeout(
        this.connection.sendRequest("shutdown", null),
        2_000
      ).catch(() => undefined);
      await this.connection.sendNotification("exit").catch(() => undefined);
    } finally {
      this.disposed = true;
      this.closed = true;
      this.connection.dispose();
      this.unsubscribeBackendClose?.();
      await this.backend.dispose().catch(() => undefined);
      this.emitStatus({ kind: "closed", message: "The language session was disposed." });
    }
  }

  private async closeAfterFailedStart(): Promise<void> {
    this.detachBinding(false);
    this.disposed = true;
    this.closed = true;
    this.connection.dispose();
    this.unsubscribeBackendClose?.();
    await this.backend.dispose().catch(() => undefined);
  }

  private initializeParams(): InitializeParams {
    return {
      processId: null,
      clientInfo: { name: "MonacoAnywhere" },
      ...(typeof navigator === "undefined" || !navigator.language
        ? {}
        : { locale: navigator.language }),
      rootUri: this.workspaceUri,
      capabilities: clientCapabilities(),
      workspaceFolders: [
        { uri: this.workspaceUri, name: `ma-${this.generation}` }
      ],
      initializationOptions: {
        clangdFileStatus: true,
        compilationDatabaseChanges: this.compilationDatabaseChanges()
      }
    };
  }

  private compilationDatabaseChanges(): Record<string, unknown> {
    return {
      [this.filePath]: {
        workingDirectory: this.directory,
        compilationCommand: [...this.compileCommand.command]
      }
    };
  }

  private configurationSettings(): Record<string, unknown> {
    return {
      compilationDatabaseChanges: this.compilationDatabaseChanges(),
      clangdFileStatus: true
    };
  }

  private async sendConfiguration(): Promise<void> {
    await this.connection.sendNotification("workspace/didChangeConfiguration", {
      settings: this.configurationSettings()
    });
  }

  private installHandlers(): void {
    this.connection.onRequest("workspace/applyEdit", (params: unknown) =>
      this.handleApplyEdit(params)
    );
    this.connection.onRequest("workspace/configuration", (params: unknown) =>
      this.handleConfiguration(params)
    );
    this.connection.onRequest("workspace/workspaceFolders", () => [
      { uri: this.workspaceUri, name: `ma-${this.generation}` }
    ]);
    this.connection.onRequest("window/workDoneProgress/create", () => null);
    this.connection.onRequest("window/showMessageRequest", () => null);
    this.connection.onRequest("client/registerCapability", (params: unknown) =>
      this.handleRegistration(params)
    );
    this.connection.onNotification("telemetry/event", () => undefined);
    this.connection.onNotification("$/progress", (params: unknown) =>
      this.handleProgress(params)
    );
    this.connection.onNotification(
      "textDocument/publishDiagnostics",
      (params: unknown) => this.handleDiagnostics(params)
    );
    this.connection.onNotification("window/logMessage", (params: unknown) =>
      this.handleWindowMessage(params)
    );
    this.connection.onNotification("window/showMessage", (params: unknown) =>
      this.handleWindowMessage(params)
    );
  }

  private handleApplyEdit(params: unknown): ApplyWorkspaceEditResult {
    const edit =
      typeof params === "object" && params !== null && "edit" in params
        ? (params as ApplyWorkspaceEditParams).edit
        : undefined;
    if (!this.activeBinding) {
      return {
        applied: false,
        failureReason: "No writable document is bound to this session."
      };
    }
    const context = this.workspaceEditContext();
    if (!context) {
      return {
        applied: false,
        failureReason: "The session has no active workspace edit context."
      };
    }
    const result = applyWorkspaceEdit(edit, context);
    return result.applied
      ? { applied: true }
      : { applied: false, failureReason: result.failureReason };
  }

  private workspaceEditContext(): WorkspaceEditContext | null {
    const binding = this.activeBinding;
    if (!binding) return null;
    return {
      model: binding.model,
      editor: binding.editor,
      lspUri: this.uri,
      lspVersion: binding.lspVersion,
      monacoVersionAtSync: binding.monacoVersionAtSync,
      isCurrent: () => this.isCurrent()
    };
  }

  private handleConfiguration(params: unknown): unknown[] {
    const items =
      typeof params === "object" &&
      params !== null &&
      "items" in params &&
      Array.isArray((params as ConfigurationParams).items)
        ? (params as ConfigurationParams).items
        : [];
    return items.map(() => this.configurationSettings());
  }

  private handleRegistration(params: unknown): null {
    const registrations =
      typeof params === "object" && params !== null && "registrations" in params
        ? (params as RegistrationParams).registrations
        : [];
    for (const registration of Array.isArray(registrations)
      ? registrations
      : []) {
      if (
        typeof registration === "object" &&
        registration !== null &&
        "id" in registration &&
        "method" in registration &&
        typeof registration.id === "string" &&
        typeof registration.method === "string"
      ) {
        this.registrations.set(registration.id, registration.method);
        this.emitStatus({
          kind: "registration",
          method: registration.method
        });
      }
    }
    return null;
  }

  private handleProgress(params: unknown): void {
    if (typeof params !== "object" || params === null) return;
    const record = params as Record<string, unknown>;
    const token = record["token"];
    const value = record["value"];
    if (
      (typeof token !== "string" && typeof token !== "number") ||
      typeof value !== "object" ||
      value === null
    ) {
      return;
    }
    const work = value as Record<string, unknown>;
    const kind = work["kind"];
    if (kind !== "begin" && kind !== "report" && kind !== "end") return;
    const progress: SessionProgress = {
      token,
      kind,
      ...(typeof work["title"] === "string" ? { title: work["title"] } : {}),
      ...(typeof work["message"] === "string" ? { message: work["message"] } : {}),
      ...(typeof work["percentage"] === "number"
        ? { percentage: work["percentage"] }
        : {})
    };
    this.emitStatus({ kind: "progress", progress });
  }

  private handleWindowMessage(params: unknown): void {
    if (typeof params !== "object" || params === null) return;
    const record = params as Record<string, unknown>;
    const message = record["message"];
    if (typeof message !== "string") return;
    const type = record["type"];
    const level =
      type === 1 ? "error" : type === 2 ? "warning" : "info";
    this.emitStatus({ kind: "message", level, message });
  }

  private handleDiagnostics(params: unknown): void {
    if (!this.isCurrent()) return;
    const binding = this.activeBinding;
    if (!binding) return;
    if (typeof params !== "object" || params === null) return;
    const record = params as Record<string, unknown>;
    if (record["uri"] !== this.uri) return;
    const version = record["version"];
    if (
      typeof version === "number" &&
      version !== binding.lspVersion
    ) {
      return;
    }
    const diagnostics = record["diagnostics"];
    if (!Array.isArray(diagnostics)) return;
    if (!binding.model.isDisposed()) {
      try {
        const markers = diagnostics
          .filter(
            (diagnostic): diagnostic is PublishDiagnosticsParams["diagnostics"][number] =>
              typeof diagnostic === "object" && diagnostic !== null
          )
          .map((diagnostic) =>
            toMonacoDiagnosticMarker(diagnostic, binding.monacoVersionAtSync)
          );
        this.monacoApi.editor.setModelMarkers(
          binding.model,
          this.owner,
          markers
        );
      } catch (error) {
        this.emitStatus({
          kind: "error",
          message:
            error instanceof Error
              ? error.message
              : "Failed to convert server diagnostics."
        });
      }
    }
  }

  private handleModelChanged(model: monaco.editor.ITextModel): void {
    const binding = this.activeBinding;
    if (!binding || binding.model !== model) return;
    if (!this.isCurrent() || model.isDisposed()) return;
    binding.lspVersion += 1;
    binding.monacoVersionAtSync = model.getVersionId();
    if (!model.isDisposed()) {
      this.monacoApi.editor.setModelMarkers(model, this.owner, []);
    }
    this.sendNotification("textDocument/didChange", {
      textDocument: { uri: this.uri, version: binding.lspVersion },
      contentChanges: [{ text: model.getValue() }]
    });
  }

  private detachBinding(sendClose: boolean): void {
    const binding = this.activeBinding;
    if (!binding) return;
    this.activeBinding = null;
    binding.contentListener.dispose();
    if (!binding.model.isDisposed()) {
      this.monacoApi.editor.setModelMarkers(binding.model, this.owner, []);
    }
    if (sendClose && !this.disposed && !this.closed) {
      this.sendNotification("textDocument/didClose", {
        textDocument: { uri: this.uri }
      });
    }
  }

  private sendNotification(method: string, params: unknown): void {
    if (this.disposed || this.closed) return;
    void this.connection.sendNotification(method, params).catch((cause) => {
      this.emitStatus({
        kind: "error",
        message:
          cause instanceof Error
            ? cause.message
            : `Failed to send ${method}.`
      });
    });
  }

  private snapshot(binding: ActiveBinding): SessionBinding {
    return {
      editor: binding.editor,
      model: binding.model,
      uri: binding.uri,
      lspVersion: binding.lspVersion,
      monacoVersionAtSync: binding.monacoVersionAtSync,
      generation: binding.generation
    };
  }

  private assertUsable(): void {
    if (!this.isCurrent()) throw new SessionStaleError();
  }

  private clearAllRegisteredState(): void {
    this.registrations.clear();
  }

  private handleTransportClosed(reason: string): void {
    if (this.closed || this.closing) return;
    this.closed = true;
    this.disposed = true;
    this.detachBinding(false);
    this.clearAllRegisteredState();
    this.connection.dispose();
    this.unsubscribeBackendClose?.();
    void this.backend.dispose().catch(() => undefined);
    this.emitStatus({ kind: "closed", message: reason });
  }

  private emitStatus(status: SessionStatus): void {
    try {
      this.onStatus?.(status);
    } catch {
      // UI status failures must not break the language session.
    }
  }
}

export async function createSession(
  options: SessionOptions
): Promise<Session> {
  const session = new Session(options);
  await session.start();
  return session;
}

function fileUri(path: string): string {
  return `file://${path
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/")}`;
}

function withTimeout<T>(promise: Promise<T>, milliseconds: number): Promise<T> {
  const { promise: result, resolve, reject } = Promise.withResolvers<T>();
  const timer = setTimeout(() => {
    reject(new Error("Timed out waiting for the language server."));
  }, milliseconds);
  promise.then(
    (value) => {
      clearTimeout(timer);
      resolve(value);
    },
    (error: unknown) => {
      clearTimeout(timer);
      reject(error);
    }
  );
  return result;
}

function clientCapabilities(): ClientCapabilities {
  const semanticTokenTypes = [
    "namespace",
    "type",
    "class",
    "enum",
    "interface",
    "struct",
    "typeParameter",
    "parameter",
    "variable",
    "property",
    "enumMember",
    "event",
    "function",
    "method",
    "macro",
    "keyword",
    "modifier",
    "comment",
    "string",
    "number",
    "regexp",
    "operator",
    "decorator"
  ];
  const semanticTokenModifiers = [
    "declaration",
    "definition",
    "readonly",
    "static",
    "deprecated",
    "abstract",
    "async",
    "modification",
    "documentation",
    "defaultLibrary"
  ];
  return {
    workspace: {
      applyEdit: true,
      workspaceEdit: {
        documentChanges: true,
        failureHandling: "abort"
      },
      configuration: true,
      workspaceFolders: true
    },
    textDocument: {
      synchronization: {
        dynamicRegistration: false,
        didSave: false,
        willSave: false,
        willSaveWaitUntil: false
      },
      completion: {
        dynamicRegistration: false,
        completionItem: {
          snippetSupport: true,
          commitCharactersSupport: true,
          documentationFormat: ["markdown", "plaintext"],
          deprecatedSupport: true,
          preselectSupport: true,
          tagSupport: { valueSet: [1] },
          insertReplaceSupport: true,
          resolveSupport: { properties: ["documentation", "detail"] },
          insertTextModeSupport: { valueSet: [1, 2] },
          labelDetailsSupport: true
        }
      },
      hover: {
        dynamicRegistration: false,
        contentFormat: ["markdown", "plaintext"]
      },
      signatureHelp: {
        dynamicRegistration: false,
        signatureInformation: {
          documentationFormat: ["markdown", "plaintext"],
          parameterInformation: { labelOffsetSupport: true },
          activeParameterSupport: true
        },
        contextSupport: true
      },
      definition: {
        dynamicRegistration: false,
        linkSupport: true
      },
      references: { dynamicRegistration: false },
      rename: {
        dynamicRegistration: false,
        prepareSupport: true
      },
      formatting: { dynamicRegistration: false },
      rangeFormatting: { dynamicRegistration: false },
      codeAction: {
        dynamicRegistration: false,
        codeActionLiteralSupport: {
          codeActionKind: {
            valueSet: [
              "",
              "quickfix",
              "refactor",
              "refactor.extract",
              "refactor.inline",
              "refactor.rewrite",
              "source",
              "source.organizeImports",
              "source.fixAll"
            ]
          }
        },
        isPreferredSupport: true,
        disabledSupport: true,
        dataSupport: true,
        resolveSupport: { properties: ["edit"] },
        honorsChangeAnnotations: true
      },
      inlayHint: {
        dynamicRegistration: false,
        resolveSupport: {
          properties: [
            "tooltip",
            "textEdits",
            "label.tooltip",
            "label.location",
            "label.command"
          ]
        }
      },
      semanticTokens: {
        dynamicRegistration: false,
        requests: { range: false, full: true },
        tokenTypes: semanticTokenTypes,
        tokenModifiers: semanticTokenModifiers,
        formats: ["relative"],
        overlappingTokenSupport: false,
        multilineTokenSupport: false,
        serverCancelSupport: true,
        augmentsSyntaxTokens: true
      },
      publishDiagnostics: {
        relatedInformation: true,
        tagSupport: { valueSet: [1, 2] },
        versionSupport: true,
        codeDescriptionSupport: true,
        dataSupport: true
      }
    },
    window: {
      workDoneProgress: true,
      showMessage: {}
    },
    general: {
      positionEncodings: ["utf-16"]
    }
  };
}

/** Exposed for provider/integration feature checks without a bound model. */
export function sessionBackendFeatures(
  session: Session
): Readonly<Record<LspFeature, boolean>> {
  return backendFeatureAvailability(session.capabilities);
}
