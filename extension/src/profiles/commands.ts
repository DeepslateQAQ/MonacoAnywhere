import {
  standardNumber,
  type CompilerProfile
} from "./types.js";

/**
 * Optional toolchain description supplied by the selected backend/data pack.
 * All paths are virtual engine paths. The command is an argv array; no shell
 * quoting or string joining is ever performed.
 */
export interface CompileEngine {
  readonly compilerName?: string;
  readonly targetTriple?: string;
  readonly sysroot?: string;
  /** Exact profile header directories, emitted as -isystem <dir>. */
  readonly includeDirectories?: readonly string[];
  /** WASM packs use their own C++ standard library; suppress the engine copy. */
  readonly noStdIncCxx?: boolean;
}

export interface CompileCommand {
  readonly file: string;
  readonly command: readonly string[];
  readonly directory: string;
}

export const DEFAULT_COMPILER_NAME = "clang++";
export const DEFAULT_MAIN_FILE = "/workspace/main.cpp";
export const DEFAULT_WORKSPACE_DIRECTORY = "/workspace";

/**
 * Build the clangd compilation-database command for one profile.
 *
 * Fixed order:
 *   compiler, -x c++, -std=..., -fsyntax-only,
 *   toolchain options, profile.args, -D macros, -D defines, source file.
 *
 * -x and -std are always generated from the profile; -std is never duplicated
 * by a profile's args. Linker and diagnostics presentation flags are not
 * added, leaving clangd's defaults intact.
 */
export function buildCompileCommand(
  profile: CompilerProfile,
  engine: CompileEngine = {}
): CompileCommand {
  const compilerName = engine.compilerName ?? DEFAULT_COMPILER_NAME;
  const command: string[] = [
    compilerName,
    "-x",
    "c++",
    `-std=${profile.dialect}${standardNumber(profile.standard)}`,
    "-fsyntax-only"
  ];

  if (engine.targetTriple) {
    command.push(`--target=${engine.targetTriple}`);
  }
  if (engine.sysroot) {
    command.push(`--sysroot=${engine.sysroot}`);
  }
  if (engine.noStdIncCxx) {
    command.push("-nostdinc++");
  }
  for (const directory of engine.includeDirectories ?? []) {
    command.push("-isystem", directory);
  }

  for (const arg of profile.args) {
    command.push(arg);
  }
  for (const macro of profile.macros) {
    command.push(`-D${macro}`);
  }
  for (const name of Object.keys(profile.defines).sort()) {
    const value = profile.defines[name];
    if (value === undefined) continue;
    command.push(`-D${name}=${value}`);
  }

  command.push(DEFAULT_MAIN_FILE);
  return {
    file: DEFAULT_MAIN_FILE,
    command,
    directory: DEFAULT_WORKSPACE_DIRECTORY
  };
}

/**
 * Move a generated command into the session's unique virtual workspace. Only
 * the argv element carrying the generated file path is replaced; this is not
 * textual command editing.
 */
export function remapCompileCommand(
  command: CompileCommand,
  file: string,
  directory: string
): CompileCommand {
  const args = [...command.command];
  const index = args.lastIndexOf(command.file);
  if (index >= 0) {
    args[index] = file;
  } else {
    args.push(file);
  }
  return { file, command: args, directory };
}
