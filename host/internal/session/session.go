// Package session owns one clangd process, one temporary workspace and one
// authenticated loopback WebSocket.
package session

import (
	"context"
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/DeepslateQAQ/MonacoAnywhere/host/internal/lspio"
	"github.com/DeepslateQAQ/MonacoAnywhere/host/internal/rewrite"

	"github.com/coder/websocket"
)

const (
	maxReadChunk = 512 * 1024
	writeDelay   = 200 * time.Millisecond
)

var versionPattern = regexp.MustCompile(`clangd version (\d+)`)

type StartOptions struct {
	ExtensionID   string
	ClangdPath    string
	QueryDrivers  []string
	ExtraIncludes []string
}

type Server struct {
	extensionID string
	clangdPath  string
	tempDir     string
	cmd         *exec.Cmd
	stdio       *lspio.Conn
	rewriter    *rewrite.Rewriter
	listener    net.Listener
	httpServer  *http.Server
	token       string
	version     string

	mu          sync.Mutex
	wsMu        sync.Mutex
	ws          *websocket.Conn
	connected   bool
	closed      bool
	stopOnce    sync.Once
	done        chan struct{}
	allowedRead []string

	syncMu      sync.Mutex
	pendingText map[string]string
	writeTimer  *time.Timer
}

type readyMessage struct {
	Type          string `json:"type"`
	Port          int    `json:"port"`
	Token         string `json:"token"`
	ClangdVersion string `json:"clangdVersion"`
}

func DiscoverClangd(explicit string) (string, error) {
	if explicit != "" {
		return exec.LookPath(explicit)
	}
	return exec.LookPath("clangd")
}

func clangdVersion(path string) (string, int, error) {
	output, err := exec.Command(path, "--version").Output()
	if err != nil {
		return "", 0, fmt.Errorf("could not run clangd --version: %w", err)
	}
	firstLine, _, _ := strings.Cut(strings.TrimSpace(string(output)), "\n")
	match := versionPattern.FindStringSubmatch(firstLine)
	if match == nil {
		return firstLine, 0, errors.New("could not parse clangd version")
	}
	major, err := strconv.Atoi(match[1])
	if err != nil {
		return firstLine, 0, errors.New("could not parse clangd major version")
	}
	return firstLine, major, nil
}

// Start launches clangd, the loopback server and returns the ready message.
func Start(options StartOptions) (*Server, readyMessage, error) {
	if !regexp.MustCompile(`^[a-p]{32}$`).MatchString(options.ExtensionID) {
		return nil, readyMessage{}, errors.New("invalid extension id")
	}
	path, err := DiscoverClangd(options.ClangdPath)
	if err != nil {
		return nil, readyMessage{}, errors.New("clangd-not-found")
	}
	version, major, err := clangdVersion(path)
	if err != nil {
		return nil, readyMessage{}, err
	}
	if major < 17 {
		return nil, readyMessage{}, errors.New("clangd-too-old")
	}

	tempDir, err := os.MkdirTemp("", "monacoanywhere-host-")
	if err != nil {
		return nil, readyMessage{}, err
	}
	if err := os.Chmod(tempDir, 0o700); err != nil {
		os.RemoveAll(tempDir)
		return nil, readyMessage{}, err
	}

	args := []string{"--background-index=false"}
	if len(options.QueryDrivers) > 0 {
		args = append(args, "--query-driver="+strings.Join(options.QueryDrivers, ","))
	}
	cmd := exec.Command(path, args...)
	cmd.Dir = tempDir
	cmd.Stderr = os.Stderr
	stdin, err := cmd.StdinPipe()
	if err != nil {
		os.RemoveAll(tempDir)
		return nil, readyMessage{}, err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		os.RemoveAll(tempDir)
		return nil, readyMessage{}, err
	}
	if err := cmd.Start(); err != nil {
		os.RemoveAll(tempDir)
		return nil, readyMessage{}, err
	}

	tokenBytes := make([]byte, 32)
	if _, err := rand.Read(tokenBytes); err != nil {
		cmd.Process.Kill()
		os.RemoveAll(tempDir)
		return nil, readyMessage{}, err
	}
	token := base64.RawURLEncoding.EncodeToString(tokenBytes)

	server := &Server{
		extensionID: options.ExtensionID,
		clangdPath:  path,
		tempDir:     tempDir,
		cmd:         cmd,
		stdio:       lspio.New(stdout, stdin),
		rewriter:    rewrite.New(tempDir),
		token:       token,
		version:     version,
		done:        make(chan struct{}),
		pendingText: make(map[string]string),
	}
	server.allowedRead = readRoots(tempDir, options.ExtraIncludes)

	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		server.kill()
		return nil, readyMessage{}, err
	}
	server.listener = listener
	server.httpServer = &http.Server{
		Handler:           server.routes(),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		if err := server.httpServer.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			fmt.Fprintf(os.Stderr, "monacoanywhere-host: http server: %v\n", err)
		}
	}()
	go server.pumpClangd()

	port := listener.Addr().(*net.TCPAddr).Port
	return server, readyMessage{
		Type:          "ma/ready",
		Port:          port,
		Token:         token,
		ClangdVersion: version,
	}, nil
}

// Stop shuts clangd down and removes the temporary workspace.
func (s *Server) Stop() {
	s.stopOnce.Do(func() {
		s.mu.Lock()
		s.closed = true
		s.mu.Unlock()
		if s.httpServer != nil {
			ctx, cancel := context.WithTimeout(context.Background(), 2*time.Second)
			s.httpServer.Shutdown(ctx)
			cancel()
		}
		if s.listener != nil {
			s.listener.Close()
		}
		s.flushAll()
		_ = s.stdio.Write([]byte(`{"jsonrpc":"2.0","id":999999,"method":"shutdown","params":null}`))
		_ = s.stdio.Write([]byte(`{"jsonrpc":"2.0","method":"exit","params":null}`))
		processDone := make(chan struct{})
		go func() {
			s.cmd.Wait()
			close(processDone)
		}()
		select {
		case <-processDone:
		case <-time.After(5 * time.Second):
			s.cmd.Process.Kill()
			<-processDone
		}
		os.RemoveAll(s.tempDir)
		close(s.done)
	})
}

func (s *Server) kill() {
	s.cmd.Process.Kill()
	s.cmd.Wait()
	os.RemoveAll(s.tempDir)
}

func (s *Server) routes() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("/lsp", s.handleWebSocket)
	mux.HandleFunc("/ma/readFile", s.handleReadFile)
	return mux
}

func (s *Server) authorize(request *http.Request) int {
	provided := ""
	if header := request.Header.Get("Authorization"); strings.HasPrefix(header, "Bearer ") {
		provided = strings.TrimPrefix(header, "Bearer ")
	}
	if provided == "" {
		for _, protocol := range strings.Split(request.Header.Get("Sec-WebSocket-Protocol"), ",") {
			protocol = strings.TrimSpace(protocol)
			if strings.HasPrefix(protocol, "ma-token.") {
				provided = strings.TrimPrefix(protocol, "ma-token.")
				break
			}
		}
	}
	if provided == "" || subtle.ConstantTimeCompare([]byte(provided), []byte(s.token)) != 1 {
		return http.StatusUnauthorized
	}
	if request.Header.Get("Origin") != "chrome-extension://"+s.extensionID {
		return http.StatusForbidden
	}
	return 0
}

func (s *Server) setCORS(writer http.ResponseWriter) {
	writer.Header().Set("Access-Control-Allow-Origin", "chrome-extension://"+s.extensionID)
	writer.Header().Set("Access-Control-Allow-Headers", "Authorization, Content-Type")
	writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	writer.Header().Set("Vary", "Origin")
}

func (s *Server) handleWebSocket(writer http.ResponseWriter, request *http.Request) {
	if status := s.authorize(request); status != 0 {
		http.Error(writer, http.StatusText(status), status)
		return
	}
	s.mu.Lock()
	if s.closed || s.connected {
		s.mu.Unlock()
		http.Error(writer, "session already has a connection", http.StatusConflict)
		return
	}
	s.connected = true
	s.mu.Unlock()

	connection, err := websocket.Accept(writer, request, &websocket.AcceptOptions{
		InsecureSkipVerify: true,
		Subprotocols:       []string{"monacoanywhere.lsp"},
	})
	if err != nil {
		s.mu.Lock()
		s.connected = false
		s.mu.Unlock()
		return
	}
	s.wsMu.Lock()
	s.ws = connection
	s.wsMu.Unlock()
	defer func() {
		s.wsMu.Lock()
		s.ws = nil
		s.wsMu.Unlock()
		s.mu.Lock()
		s.connected = false
		s.mu.Unlock()
		connection.Close(websocket.StatusNormalClosure, "session ended")
		s.Stop()
	}()

	for {
		kind, payload, err := connection.Read(context.Background())
		if err != nil {
			return
		}
		if kind != websocket.MessageText {
			continue
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		s.rewriter.MessageToDisk(message)
		s.trackDocument(message)
		if err := s.writeClangd(message); err != nil {
			return
		}
	}
}

func (s *Server) writeClangd(message map[string]any) error {
	payload, err := json.Marshal(message)
	if err != nil {
		return err
	}
	return s.stdio.Write(payload)
}

func (s *Server) pumpClangd() {
	for {
		payload, err := s.stdio.Read()
		if err != nil {
			if !s.isClosed() {
				fmt.Fprintf(os.Stderr, "monacoanywhere-host: clangd pipe: %v\n", err)
			}
			s.Stop()
			return
		}
		var message map[string]any
		if err := json.Unmarshal(payload, &message); err != nil {
			continue
		}
		s.rewriter.MessageToVirtual(message)
		s.sendToBrowser(message)
	}
}

func (s *Server) sendToBrowser(message map[string]any) {
	payload, err := json.Marshal(message)
	if err != nil {
		return
	}
	s.wsMu.Lock()
	connection := s.ws
	s.wsMu.Unlock()
	if connection == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = connection.Write(ctx, websocket.MessageText, payload)
}

func (s *Server) isClosed() bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.closed
}

func (s *Server) trackDocument(message map[string]any) {
	method, _ := message["method"].(string)
	params, _ := message["params"].(map[string]any)
	if params == nil {
		return
	}
	textDocument, _ := params["textDocument"].(map[string]any)
	uri, _ := textDocument["uri"].(string)
	if uri == "" {
		return
	}
	switch method {
	case "textDocument/didOpen":
		text, _ := textDocument["text"].(string)
		s.cacheText(uri, text, true)
	case "textDocument/didChange":
		changes, _ := params["contentChanges"].([]any)
		if len(changes) == 0 {
			return
		}
		last, _ := changes[len(changes)-1].(map[string]any)
		if _, hasRange := last["range"]; hasRange {
			return
		}
		text, _ := last["text"].(string)
		s.cacheText(uri, text, false)
	case "textDocument/didSave":
		s.flushAll()
	}
}

func (s *Server) cacheText(uri, text string, immediate bool) {
	path := s.diskPathFromURI(uri)
	if path == "" {
		return
	}
	s.syncMu.Lock()
	s.pendingText[path] = text
	if s.writeTimer != nil {
		s.writeTimer.Stop()
	}
	s.writeTimer = time.AfterFunc(writeDelay, s.flushAll)
	s.syncMu.Unlock()
	if immediate {
		s.flushAll()
	}
}

func (s *Server) flushAll() {
	s.syncMu.Lock()
	writes := s.pendingText
	s.pendingText = make(map[string]string)
	timer := s.writeTimer
	s.writeTimer = nil
	s.syncMu.Unlock()
	if timer != nil {
		timer.Stop()
	}
	for path, text := range writes {
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			continue
		}
		_ = os.WriteFile(path, []byte(text), 0o600)
	}
}

func (s *Server) diskPathFromURI(value string) string {
	parsed, err := url.Parse(value)
	if err != nil || parsed.Scheme != "file" {
		return ""
	}
	clean := filepath.Clean(parsed.Path)
	if clean == s.tempDir || strings.HasPrefix(clean, s.tempDir+string(filepath.Separator)) {
		return clean
	}
	return ""
}
