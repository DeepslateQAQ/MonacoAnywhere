//go:build windows

package install

import (
	"os"
	"path/filepath"

	"golang.org/x/sys/windows/registry"
)

func hostManifestPath(browser string) (string, error) {
	local := os.Getenv("LOCALAPPDATA")
	if local == "" {
		return "", os.ErrNotExist
	}
	return filepath.Join(local, "MonacoAnywhere", HostName+".json"), nil
}

func registryPath(browser string) string {
	name := "Google\\Chrome"
	if browser == "edge" {
		name = "Microsoft\\Edge"
	}
	return `Software\` + name + `\NativeMessagingHosts\` + HostName
}

func registerPlatform(browsers []string, manifestPath string) error {
	for _, browser := range browsers {
		key, _, err := registry.CreateKey(registry.CURRENT_USER, registryPath(browser), registry.WRITE)
		if err != nil {
			return err
		}
		err = key.SetStringValue("", manifestPath)
		key.Close()
		if err != nil {
			return err
		}
	}
	return nil
}

func unregisterPlatform(browsers []string) error {
	for _, browser := range browsers {
		_ = registry.DeleteKey(registry.CURRENT_USER, registryPath(browser))
	}
	return nil
}
