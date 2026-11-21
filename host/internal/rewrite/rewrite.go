// Package rewrite maps MonacoAnywhere's virtual workspace paths to the native
// temporary directory. It rewrites protocol fields only: document text,
// completion strings, diagnostics messages and command arguments are never
// altered.
package rewrite

import (
	"net/url"
	"path/filepath"
	"strings"
)

const (
	virtualRoot   = "/workspace"
	toolchainRoot = "/toolchain"
)

type Rewriter struct {
	TempDir string
}

func New(tempDir string) *Rewriter {
	return &Rewriter{TempDir: filepath.Clean(tempDir)}
}

func fileURI(path string) string {
	return (&url.URL{Scheme: "file", Path: path}).String()
}

func (r *Rewriter) diskPath(virtual string) (string, bool) {
	if virtual == virtualRoot {
		return r.TempDir, true
	}
	if strings.HasPrefix(virtual, virtualRoot+"/") {
		rest := strings.TrimPrefix(virtual, virtualRoot+"/")
		return filepath.Join(r.TempDir, filepath.FromSlash(rest)), true
	}
	return "", false
}

// MessageToDisk rewrites a client JSON-RPC message in place.
func (r *Rewriter) MessageToDisk(message map[string]any) {
	rewriteMap(message, true, r)
}

// MessageToVirtual rewrites a server JSON-RPC message in place.
func (r *Rewriter) MessageToVirtual(message map[string]any) {
	rewriteMap(message, false, r)
}

func rewriteMap(object map[string]any, toDisk bool, r *Rewriter) {
	for key, value := range object {
		switch key {
		case "uri", "targetUri", "oldUri", "newUri", "baseUri", "rootUri":
			if text, ok := value.(string); ok {
				object[key] = r.mapURI(text, toDisk)
			}
		case "file":
			if _, hasSelection := object["selection"]; hasSelection {
				if _, hasTweak := object["tweakID"]; hasTweak {
					if text, ok := value.(string); ok {
						object[key] = r.mapURI(text, toDisk)
					}
				}
			}
		case "changes":
			if changes, ok := value.(map[string]any); ok && looksLikeURIKeys(changes) {
				mapped := make(map[string]any, len(changes))
				for uri, edit := range changes {
					rewriteValue(&edit, toDisk, r)
					mapped[r.mapURI(uri, toDisk)] = edit
				}
				object[key] = mapped
				continue
			}
			rewriteValue(&value, toDisk, r)
		case "compilationDatabaseChanges":
			if databases, ok := value.(map[string]any); ok {
				mapped := make(map[string]any, len(databases))
				for path, entry := range databases {
					if toDisk {
						path, _ = r.mapPath(path, true)
					}
					rewriteValue(&entry, toDisk, r)
					mapped[path] = entry
				}
				object[key] = mapped
				continue
			}
			rewriteValue(&value, toDisk, r)
		case "workingDirectory", "rootPath":
			if text, ok := value.(string); ok {
				mapped, _ := r.mapPath(text, toDisk)
				object[key] = mapped
				continue
			}
			rewriteValue(&value, toDisk, r)
		case "compilationCommand":
			if args, ok := value.([]any); ok {
				copied := make([]any, len(args))
				for index, arg := range args {
					if text, ok := arg.(string); ok && toDisk {
						text, _ = r.mapPath(text, true)
						copied[index] = text
					} else {
						copied[index] = arg
					}
				}
				object[key] = copied
				continue
			}
			rewriteValue(&value, toDisk, r)
		default:
			rewriteValue(&value, toDisk, r)
		}
	}
}

func rewriteValue(value *any, toDisk bool, r *Rewriter) {
	switch current := (*value).(type) {
	case map[string]any:
		rewriteMap(current, toDisk, r)
	case []any:
		for index := range current {
			rewriteValue(&current[index], toDisk, r)
		}
	}
}

func looksLikeURIKeys(changes map[string]any) bool {
	for key := range changes {
		if strings.Contains(key, "://") {
			return true
		}
	}
	return false
}

// mapURI converts between file:///workspace/... and the private temp directory.
func (r *Rewriter) mapURI(value string, toDisk bool) string {
	if !strings.HasPrefix(value, "file:") {
		return value
	}
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "file" {
		return value
	}
	path := parsed.Path
	if toDisk {
		if disk, ok := r.diskPath(path); ok {
			return fileURI(disk)
		}
		return value
	}
	clean := filepath.Clean(path)
	if clean == r.TempDir || strings.HasPrefix(clean, r.TempDir+string(filepath.Separator)) {
		relative, err := filepath.Rel(r.TempDir, clean)
		if err == nil {
			return fileURI(virtualRoot + "/" + filepath.ToSlash(relative))
		}
	}
	return fileURI(toolchainRoot + clean)
}

// mapPath maps a filesystem operand used in compile commands, not free text.
func (r *Rewriter) mapPath(value string, toDisk bool) (string, bool) {
	if toDisk {
		if disk, ok := r.diskPath(filepath.Clean(value)); ok {
			return disk, true
		}
		return value, false
	}
	clean := filepath.Clean(value)
	if clean == r.TempDir || strings.HasPrefix(clean, r.TempDir+string(filepath.Separator)) {
		relative, err := filepath.Rel(r.TempDir, clean)
		if err == nil {
			return virtualRoot + "/" + filepath.ToSlash(relative), true
		}
	}
	return value, false
}
