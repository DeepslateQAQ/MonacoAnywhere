// Package install registers the native messaging host per user.
package install

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const HostName = "com.monacoanywhere.host"

type Manifest struct {
	Name           string   `json:"name"`
	Description    string   `json:"description"`
	Path           string   `json:"path"`
	Type           string   `json:"type"`
	AllowedOrigins []string `json:"allowed_origins"`
}

func normalizeBrowsers(browsers []string) ([]string, error) {
	if len(browsers) == 0 {
		return nil, errors.New("no browsers selected")
	}
	seen := make(map[string]bool)
	var result []string
	for _, browser := range browsers {
		browser = strings.ToLower(strings.TrimSpace(browser))
		if browser != "chrome" && browser != "edge" {
			return nil, fmt.Errorf("unsupported browser %q", browser)
		}
		if !seen[browser] {
			seen[browser] = true
			result = append(result, browser)
		}
	}
	return result, nil
}

// Install writes the host manifest at every per-user browser location and
// returns the path written for Chrome (or the first browser selected).
func Install(extensionID string, browsers []string) (string, error) {
	selected, err := normalizeBrowsers(browsers)
	if err != nil {
		return "", err
	}
	executable, err := os.Executable()
	if err != nil {
		return "", err
	}
	executable, err = filepath.Abs(executable)
	if err != nil {
		return "", err
	}
	manifest := Manifest{
		Name:           HostName,
		Description:    "MonacoAnywhere clangd host",
		Path:           executable,
		Type:           "stdio",
		AllowedOrigins: []string{"chrome-extension://" + extensionID + "/"},
	}
	payload, err := json.MarshalIndent(manifest, "", "  ")
	if err != nil {
		return "", err
	}
	payload = append(payload, '\n')
	firstPath := ""
	for _, browser := range selected {
		path, err := hostManifestPath(browser)
		if err != nil {
			return "", err
		}
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return "", err
		}
		if err := os.WriteFile(path, payload, 0o644); err != nil {
			return "", err
		}
		if firstPath == "" {
			firstPath = path
		}
	}
	if err := registerPlatform(selected, firstPath); err != nil {
		return "", err
	}
	return firstPath, nil
}

func Uninstall(browsers []string) error {
	selected, err := normalizeBrowsers(browsers)
	if err != nil {
		return err
	}
	for _, browser := range selected {
		path, err := hostManifestPath(browser)
		if err != nil {
			continue
		}
		_ = os.Remove(path)
	}
	return unregisterPlatform(selected)
}
