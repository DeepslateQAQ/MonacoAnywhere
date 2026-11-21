// Package rewrite maps the extension's virtual LSP filesystem to the private
// temporary directory used by clangd. Only protocol URI/path roles are
// rewritten; arbitrary text fields are never touched.
package rewrite

import (
	"fmt"
	"net/url"
	"path/filepath"
	"runtime"
	"strings"
)

const (
	// VirtualWorkspaceRoot is the URI path prefix owned by the extension.
	VirtualWorkspaceRoot = "/workspace"
	// ToolchainRoot is the URI path prefix for headers outside the workspace.
	ToolchainRoot = "/toolchain"
)

// Mapper maps between virtual protocol paths and a private temp directory.
type Mapper struct {
	root string
}

// NewMapper creates a mapper whose tempRoot corresponds to /workspace.
func NewMapper(tempRoot string) (*Mapper, error) {
	if tempRoot == "" || strings.ContainsRune(tempRoot, 0) {
		return nil, fmt.Errorf("invalid workspace root")
	}
	abs, err := filepath.Abs(tempRoot)
	if err != nil {
		return nil, err
	}
	// Resolve symlinks so server paths are compared against the same spelling
	// clangd actually observes (notably /var -> /private/var on macOS).
	if real, err := filepath.EvalSymlinks(abs); err == nil {
		abs = real
	}
	return &Mapper{root: filepath.Clean(abs)}, nil
}

// Root returns the canonical lexical temp root.
func (m *Mapper) Root() string { return m.root }

// VirtualToReal maps a client file URI or absolute virtual path to a host path.
// It accepts /workspace/... virtual paths and /toolchain/... references, and
// leaves unrelated paths untouched (ok=false).
func (m *Mapper) VirtualToReal(value string) (string, bool) {
	if pathPart, ok := localFileURIPath(value); ok {
		if real, ok := m.virtualPathToReal(pathPart); ok {
			return real, true
		}
		if hostPath, ok := toolchainPath(pathPart); ok {
			return hostPath, true
		}
		return "", false
	}
	if isAbsLike(value) {
		if real, ok := m.virtualPathToReal(value); ok {
			return real, true
		}
		if hostPath, ok := toolchainPlainPath(value); ok {
			return hostPath, true
		}
	}
	return "", false
}

// RealToVirtual maps a server-side absolute host path to a virtual workspace
// URI when it is inside the temp root, or to a /toolchain URI otherwise.
func (m *Mapper) RealToVirtual(abs string) (string, bool) {
	if abs == "" || strings.ContainsRune(abs, 0) || !filepath.IsAbs(abs) {
		return "", false
	}
	clean := filepath.Clean(abs)
	if rel, within := RelWithin(m.root, clean); within {
		if rel == "." {
			return "", false
		}
		return virtualURI(filepath.ToSlash(rel)), true
	}
	return toolchainURI(clean), true
}

// WorkspaceRealPath resolves only file:///workspace/... URIs.
func (m *Mapper) WorkspaceRealPath(uri string) (string, bool) {
	pathPart, ok := localFileURIPath(uri)
	if !ok {
		return "", false
	}
	return m.virtualPathToReal(pathPart)
}

// ToolchainRealPath resolves only file:///toolchain/... URIs back to the
// absolute host path they reference. The caller must still apply an allowlist.
func (m *Mapper) ToolchainRealPath(uri string) (string, bool) {
	pathPart, ok := localFileURIPath(uri)
	if !ok {
		return "", false
	}
	return toolchainPath(pathPart)
}

// LocalFileRealPath parses any local file URI and returns its host path.
// Callers must apply an allowlist before opening the path.
func LocalFileRealPath(uri string) (string, bool) {
	pathPart, ok := localFileURIPath(uri)
	if !ok {
		return "", false
	}
	host := hostPathFromURLPath(pathPart, runtime.GOOS == "windows")
	if host == "" {
		return "", false
	}
	return host, true
}

func (m *Mapper) virtualPathToReal(pathPart string) (string, bool) {
	pathPart = strings.ReplaceAll(pathPart, `\`, "/")
	prefix := VirtualWorkspaceRoot + "/"
	if !strings.HasPrefix(pathPart, prefix) {
		return "", false
	}
	rel := strings.TrimPrefix(pathPart, prefix)
	if !validRelPath(rel) {
		return "", false
	}
	real := filepath.Join(m.root, filepath.FromSlash(rel))
	if _, ok := RelWithin(m.root, real); !ok {
		return "", false
	}
	return real, true
}

func validRelPath(rel string) bool {
	if rel == "" || strings.ContainsRune(rel, 0) {
		return false
	}
	for _, part := range strings.Split(rel, "/") {
		if part == "" || part == "." || part == ".." {
			return false
		}
		if strings.ContainsAny(part, `\:`) {
			return false
		}
		for _, r := range part {
			if r < 0x20 || r == 0x7f {
				return false
			}
		}
	}
	return true
}

func toolchainPath(pathPart string) (string, bool) {
	pathPart = strings.ReplaceAll(pathPart, `\`, "/")
	prefix := ToolchainRoot + "/"
	if !strings.HasPrefix(pathPart, prefix) {
		return "", false
	}
	rest := strings.TrimPrefix(pathPart, ToolchainRoot)
	host := hostPathFromURLPath(rest, runtime.GOOS == "windows")
	if host == "" || !filepath.IsAbs(host) {
		return "", false
	}
	return filepath.Clean(host), true
}

func toolchainPlainPath(value string) (string, bool) {
	value = strings.ReplaceAll(value, `\`, "/")
	if !strings.HasPrefix(value, ToolchainRoot+"/") {
		return "", false
	}
	return toolchainPath(value)
}

// hostPathFromURLPath converts a URL path (always slash-separated) to a host
// path. The windows flag exists so the conversion is unit-testable on Linux.
func hostPathFromURLPath(p string, windows bool) string {
	if p == "" || strings.ContainsRune(p, 0) {
		return ""
	}
	if windows {
		if len(p) >= 3 && p[0] == '/' && isDriveLetter(p[1]) && p[2] == ':' {
			p = p[1:]
		}
		p = filepath.FromSlash(p)
	} else {
		p = filepath.Clean(p)
	}
	return p
}

func virtualURI(rel string) string {
	u := url.URL{Scheme: "file", Path: VirtualWorkspaceRoot + "/" + rel}
	return u.String()
}

// RealPathURI renders an absolute host path as a file:// URI.
func RealPathURI(abs string) string {
	u := url.URL{Scheme: "file", Path: urlPathFromHostPath(abs, runtime.GOOS == "windows")}
	return u.String()
}

func toolchainURI(abs string) string {
	path := urlPathFromHostPath(abs, runtime.GOOS == "windows")
	u := url.URL{Scheme: "file", Path: ToolchainRoot + path}
	return u.String()
}

func urlPathFromHostPath(abs string, windows bool) string {
	p := filepath.ToSlash(abs)
	if windows {
		if len(p) >= 2 && isDriveLetter(p[0]) && p[1] == ':' {
			p = "/" + p
		}
	}
	if !strings.HasPrefix(p, "/") {
		p = "/" + p
	}
	return p
}

func localFileURIPath(raw string) (string, bool) {
	if raw == "" || strings.ContainsRune(raw, 0) {
		return "", false
	}
	u, err := url.Parse(raw)
	if err != nil || !strings.EqualFold(u.Scheme, "file") || u.Opaque != "" {
		return "", false
	}
	if u.Host != "" && !strings.EqualFold(u.Host, "localhost") {
		return "", false
	}
	if u.RawQuery != "" || u.Fragment != "" {
		return "", false
	}
	if u.Path == "" {
		return "", false
	}
	return u.Path, true
}

func isAbsLike(value string) bool {
	if value == "" || strings.ContainsRune(value, 0) {
		return false
	}
	if strings.HasPrefix(value, "/") {
		return true
	}
	return runtime.GOOS == "windows" && filepath.IsAbs(value)
}

func isDriveLetter(b byte) bool {
	return (b >= 'a' && b <= 'z') || (b >= 'A' && b <= 'Z')
}

// RelWithin reports whether target is root or lexically below root, returning
// the relative path. Component boundaries are respected ("/workspaceevil" is
// not inside "/workspace").
func RelWithin(root, target string) (string, bool) {
	cleanRoot := filepath.Clean(root)
	cleanTarget := filepath.Clean(target)
	rel, err := filepath.Rel(cleanRoot, cleanTarget)
	if err != nil {
		return "", false
	}
	if rel == "." {
		return "", true
	}
	if rel == ".." || filepath.IsAbs(rel) ||
		strings.HasPrefix(rel, ".."+string(filepath.Separator)) {
		return "", false
	}
	return rel, true
}
