//go:build linux || darwin

package install

import (
	"os"
	"path/filepath"
	"runtime"
)

func hostManifestPath(browser string) (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	if runtime.GOOS == "darwin" {
		directory := "Google/Chrome"
		if browser == "edge" {
			directory = "Microsoft Edge"
		}
		return filepath.Join(home, "Library", "Application Support", directory,
			"NativeMessagingHosts", HostName+".json"), nil
	}
	directory := "google-chrome"
	if browser == "edge" {
		directory = "microsoft-edge"
	}
	return filepath.Join(home, ".config", directory, "NativeMessagingHosts", HostName+".json"), nil
}

func registerPlatform(browsers []string, manifestPath string) error { return nil }
func unregisterPlatform(browsers []string) error                    { return nil }
