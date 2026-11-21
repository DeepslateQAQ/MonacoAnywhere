/*
 * Monaco commands cannot safely execute arbitrary server-provided command ids.
 * This bridge registers only clangd's documented apply commands, under
 * extension-owned namespaced ids, and forwards the protocol result unchanged.
 */

import type * as monaco from "monaco-editor";
import type {
  Command as LspCommand,
  ServerCapabilities
} from "vscode-languageserver-protocol";

import type { CommandWrapper } from "./conversions.js";
import type { Session } from "./session.js";

export const ALLOWED_CLANGD_COMMANDS = [
  "clangd.applyFix",
  "clangd.applyTweak",
  "clangd.applyRename"
] as const;

export type AllowedClangdCommand = (typeof ALLOWED_CLANGD_COMMANDS)[number];

export interface CommandBridge {
  readonly wrapCommand: CommandWrapper;
  readonly dispose: () => void;
  readonly commandNames: readonly string[];
}

function isAllowedCommand(value: string): value is AllowedClangdCommand {
  return (ALLOWED_CLANGD_COMMANDS as readonly string[]).includes(value);
}

export function advertisedClangdCommands(
  capabilities: ServerCapabilities
): readonly AllowedClangdCommand[] {
  const advertised = capabilities.executeCommandProvider?.commands ?? [];
  const available = new Set(advertised);
  return ALLOWED_CLANGD_COMMANDS.filter((command) => available.has(command));
}

/**
 * Register the advertised allowed commands. This must be called once per
 * session after initialize and disposed with the providers.
 */
export function createCommandBridge(
  monacoApi: typeof monaco,
  session: Session
): CommandBridge {
  const advertised = advertisedClangdCommands(session.capabilities);
  const namespaced = new Map<AllowedClangdCommand, string>();
  const disposables: monaco.IDisposable[] = [];
  const registerCommand = monacoApi.editor.registerCommand;

  if (typeof registerCommand === "function") {
    advertised.forEach((command, index) => {
      const id = `ma.${session.id}.${index}`;
      try {
        disposables.push(
          registerCommand(id, (_accessor, ...args: unknown[]) =>
            session.request("workspace/executeCommand", {
              command,
              arguments: args
            })
          )
        );
        namespaced.set(command, id);
      } catch {
        // A retained Monaco build may reject command registration; the
        // capability is then reported as unavailable through wrapCommand.
      }
    });
  }

  const wrapCommand: CommandWrapper = (
    command: LspCommand
  ): monaco.languages.Command | undefined => {
    if (!isAllowedCommand(command.command)) return undefined;
    const id = namespaced.get(command.command);
    if (!id) return undefined;
    return {
      id,
      title: command.title,
      ...(command.arguments === undefined
        ? {}
        : { arguments: command.arguments })
    };
  };

  return {
    wrapCommand,
    commandNames: [...namespaced.keys()],
    dispose: () => {
      for (const disposable of disposables.splice(0)) {
        disposable.dispose();
      }
      namespaced.clear();
    }
  };
}
