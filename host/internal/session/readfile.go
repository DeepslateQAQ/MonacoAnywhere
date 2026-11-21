package session

import (
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
)

type readFileRequest struct {
	Path   string `json:"path"`
	Offset int64  `json:"offset"`
	Length int    `json:"length"`
}

type readFileResponse struct {
	Bytes      string `json:"bytes"`
	NextOffset int64  `json:"nextOffset"`
	EOF        bool   `json:"eof"`
	Error      string `json:"error,omitempty"`
}

func readRoots(tempDir string, extra []string) []string {
	roots := []string{tempDir}
	for _, directory := range extra {
		if directory == "" || !filepath.IsAbs(directory) {
			continue
		}
		roots = append(roots, filepath.Clean(directory))
	}
	// clang resource headers are commonly under these prefixes. Only existing
	// directories are recorded, and each file read is canonicalised again.
	for _, pattern := range []string{
		"/usr/lib/clang/*/include",
		"/usr/local/lib/clang/*/include",
		"/usr/lib/llvm-*/lib/clang/*/include",
	} {
		matches, _ := filepath.Glob(pattern)
		roots = append(roots, matches...)
	}
	return roots
}

func (s *Server) virtualToDisk(candidate string) (string, bool) {
	if parsed, err := url.Parse(candidate); err == nil && parsed.Scheme == "file" {
		candidate = parsed.Path
	}
	if candidate == "/workspace" {
		return s.tempDir, true
	}
	if strings.HasPrefix(candidate, "/workspace/") {
		return filepath.Join(s.tempDir, filepath.FromSlash(strings.TrimPrefix(candidate, "/workspace/"))), true
	}
	if strings.HasPrefix(candidate, "/toolchain/") {
		return filepath.FromSlash(strings.TrimPrefix(candidate, "/toolchain/")), true
	}
	return candidate, false
}

func (s *Server) readablePath(candidate string) (string, bool) {
	if mapped, ok := s.virtualToDisk(candidate); ok {
		candidate = mapped
	}
	if candidate == "" || !filepath.IsAbs(candidate) {
		return "", false
	}
	clean := filepath.Clean(candidate)
	resolved, err := filepath.EvalSymlinks(clean)
	if err != nil {
		resolved = clean
	}
	for _, root := range s.allowedRead {
		rootResolved, err := filepath.EvalSymlinks(root)
		if err != nil {
			rootResolved = filepath.Clean(root)
		}
		if resolved == rootResolved ||
			strings.HasPrefix(resolved, rootResolved+string(filepath.Separator)) {
			return resolved, true
		}
	}
	return "", false
}

func (s *Server) handleReadFile(writer http.ResponseWriter, request *http.Request) {
	s.setCORS(writer)
	if request.Method == http.MethodOptions {
		writer.WriteHeader(http.StatusNoContent)
		return
	}
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	if status := s.authorize(request); status != 0 {
		http.Error(writer, http.StatusText(status), status)
		return
	}
	var payload readFileRequest
	if err := json.NewDecoder(http.MaxBytesReader(writer, request.Body, 64*1024)).Decode(&payload); err != nil {
		http.Error(writer, "invalid request", http.StatusBadRequest)
		return
	}
	if payload.Offset < 0 {
		http.Error(writer, "invalid offset", http.StatusBadRequest)
		return
	}
	length := payload.Length
	if length <= 0 || length > maxReadChunk {
		length = maxReadChunk
	}
	path, allowed := s.readablePath(payload.Path)
	if !allowed {
		http.Error(writer, "path is not allowed", http.StatusForbidden)
		return
	}
	file, err := os.Open(path)
	if err != nil {
		http.Error(writer, "could not open file", http.StatusNotFound)
		return
	}
	defer file.Close()
	buffer := make([]byte, length)
	count, err := file.ReadAt(buffer, payload.Offset)
	if err != nil && count == 0 {
		if payload.Offset == 0 {
			http.Error(writer, "could not read file", http.StatusNotFound)
			return
		}
	}
	buffer = buffer[:count]
	info, _ := file.Stat()
	eof := true
	if info != nil {
		eof = payload.Offset+int64(count) >= info.Size()
	}
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(readFileResponse{
		Bytes:      base64.StdEncoding.EncodeToString(buffer),
		NextOffset: payload.Offset + int64(count),
		EOF:        eof,
	})
}
