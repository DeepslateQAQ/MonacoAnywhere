export type OffscreenBackendKind = "wasm" | "native";

export interface NativeCredentials {
  port: number;
  token: string;
}

export interface OpenBackendMessage {
  type: "ma/backend-open";
  sessionId: string;
  backend: OffscreenBackendKind;
  packId: string | null;
  native: NativeCredentials | null;
}

export interface CloseBackendMessage {
  type: "ma/backend-close";
  sessionId: string;
}

export interface SendBackendMessage {
  type: "ma/backend-send";
  sessionId: string;
  message: object;
}

export interface ReadBackendFileMessage {
  type: "ma/backend-read-file";
  sessionId: string;
  id: number;
  uri: string;
}

export type OffscreenIncoming =
  | OpenBackendMessage
  | CloseBackendMessage
  | SendBackendMessage
  | ReadBackendFileMessage;

export interface BackendReadyMessage {
  type: "ma/backend-ready";
  sessionId: string;
}

export interface BackendErrorMessage {
  type: "ma/backend-error";
  sessionId: string;
  code: string;
  message: string;
}

export interface BackendIncomingMessage {
  type: "ma/backend-message";
  sessionId: string;
  message: object;
}

export interface BackendClosedMessage {
  type: "ma/backend-closed";
  sessionId: string;
  reason: string;
}

export interface BackendFileMessage {
  type: "ma/backend-file";
  sessionId: string;
  id: number;
  text: string | null;
}

export type OffscreenOutgoing =
  | BackendReadyMessage
  | BackendErrorMessage
  | BackendIncomingMessage
  | BackendClosedMessage
  | BackendFileMessage;
