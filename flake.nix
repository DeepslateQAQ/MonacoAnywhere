{
  description = "MonacoAnywhere reproducible Chromium extension and native-host toolchain";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/f9a75f4";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "aarch64-darwin" "x86_64-darwin" ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in {
      devShells = forAllSystems (system:
        let pkgs = import nixpkgs { inherit system; };
        in rec {
          default = pkgs.mkShell {
            packages = with pkgs; [
              nodejs_24 pnpm go gcc llvmPackages_latest.clang-tools
              llvmPackages_latest.clang llvmPackages_latest.lld emscripten
              cmake ninja python3 git curl pkg-config openssl unzip zip wabt
            ];
            shellHook = ''
              export MONACOANYWHERE_ROOT="$PWD"
              export EM_CACHE="$PWD/.build/emscripten-cache"
            '';
          };
          browser = pkgs.mkShell {
            inputsFrom = [ default ];
            packages = pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux [ pkgs.chromium ];
            shellHook = pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
              export CHROMIUM_EXECUTABLE="${pkgs.chromium}/bin/chromium"
            '';
          };
        });
    };
}
