package rewrite

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"
)

func testMapper(t *testing.T) (*Mapper, string) {
	t.Helper()
	root := t.TempDir()
	m, err := NewMapper(root)
	if err != nil {
		t.Fatal(err)
	}
	return m, m.Root()
}

func TestVirtualToReal(t *testing.T) {
	m, root := testMapper(t)
	want := filepath.Join(root, "ma-1", "main.cpp")

	for _, input := range []string{
		"file:///workspace/ma-1/main.cpp",
		"/workspace/ma-1/main.cpp",
	} {
		got, ok := m.VirtualToReal(input)
		if !ok || got != want {
			t.Fatalf("%q -> %q, %v; want %q", input, got, ok, want)
		}
	}

	for _, input := range []string{
		"/workspaceevil/x.cpp",
		"file:///workspaceevil/x.cpp",
		"file:///workspace/../etc/passwd",
		"file:///workspace/ma-1/%2e%2e/escape.h",
		"file:///workspace/ma-1/%5Cescape.h",
		"https://example.com/x",
	} {
		if got, ok := m.VirtualToReal(input); ok {
			t.Fatalf("%q unexpectedly mapped to %q", input, got)
		}
	}
}

func TestRealToVirtualAndToolchainRoundTrip(t *testing.T) {
	m, root := testMapper(t)
	inside := filepath.Join(root, "ma-1", "a b.h")
	uri, ok := m.RealToVirtual(inside)
	if !ok {
		t.Fatal("inside path did not map")
	}
	if uri != "file:///workspace/ma-1/a%20b.h" {
		t.Fatalf("uri = %q", uri)
	}
	back, ok := m.WorkspaceRealPath(uri)
	if !ok || back != inside {
		t.Fatalf("round trip = %q, %v", back, ok)
	}

	outside := filepath.Join(string(filepath.Separator), "opt", "ma headers", "vector")
	toolchain, ok := m.RealToVirtual(outside)
	if !ok {
		t.Fatal("outside path did not map")
	}
	if !strings.HasPrefix(toolchain, "file:///toolchain/") {
		t.Fatalf("toolchain uri = %q", toolchain)
	}
	back, ok = m.ToolchainRealPath(toolchain)
	if !ok || back != outside {
		t.Fatalf("toolchain round trip = %q, %v; want %q", back, ok, outside)
	}
}

func TestRelWithinBoundary(t *testing.T) {
	root := filepath.Join(string(filepath.Separator), "tmp", "ws")
	if _, ok := RelWithin(root, filepath.Join(root, "a")); !ok {
		t.Fatal("child should be inside")
	}
	if _, ok := RelWithin(root, root+"evil"); ok {
		t.Fatal("prefix sibling must not be inside")
	}
	if _, ok := RelWithin(root, filepath.Dir(root)); ok {
		t.Fatal("parent must not be inside")
	}
}

func TestWindowsDriveURLConversion(t *testing.T) {
	got := hostPathFromURLPath("/C:/Users/ma/x.h", true)
	want := filepath.FromSlash("C:/Users/ma/x.h")
	if got != want {
		t.Fatalf("host path = %q, want %q", got, want)
	}
	got = urlPathFromHostPath("C:/Users/ma/x.h", true)
	if got != "/C:/Users/ma/x.h" {
		t.Fatalf("url path = %q", got)
	}
}

func TestClientToServerPreservesText(t *testing.T) {
	m, root := testMapper(t)
	text := "// file:///workspace/ma-1/main.cpp /workspace/ma-1/main.cpp\nint main(){}"
	msg := map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didOpen",
		"params": map[string]any{
			"textDocument": map[string]any{
				"uri":        "file:///workspace/ma-1/main.cpp",
				"languageId": "cpp",
				"version":    1,
				"text":       text,
			},
		},
	}
	raw, _ := json.Marshal(msg)
	out, update, err := ClientToServer(raw, m)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	td := parsed["params"].(map[string]any)["textDocument"].(map[string]any)
	wantURI := RealPathURI(filepath.Join(root, "ma-1", "main.cpp"))
	if td["uri"] != wantURI {
		t.Fatalf("uri = %v, want %v", td["uri"], wantURI)
	}
	if td["text"] != text {
		t.Fatalf("text was modified: %q", td["text"])
	}
	if update == nil || update.Path != filepath.Join(root, "ma-1", "main.cpp") || string(update.Text) != text {
		t.Fatalf("unexpected document update: %+v", update)
	}
}

func TestClientToServerIncrementalChangeNotCached(t *testing.T) {
	m, _ := testMapper(t)
	msg := map[string]any{
		"jsonrpc": "2.0",
		"method":  "textDocument/didChange",
		"params": map[string]any{
			"textDocument": map[string]any{"uri": "file:///workspace/ma-1/main.cpp", "version": 2},
			"contentChanges": []any{
				map[string]any{
					"range": map[string]any{
						"start": map[string]any{"line": 0, "character": 0},
						"end":   map[string]any{"line": 0, "character": 0},
					},
					"text": "x",
				},
			},
		},
	}
	raw, _ := json.Marshal(msg)
	out, update, err := ClientToServer(raw, m)
	if err != nil {
		t.Fatal(err)
	}
	if update != nil {
		t.Fatalf("incremental update should not be cached: %+v", update)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	td := parsed["params"].(map[string]any)["textDocument"].(map[string]any)
	if td["uri"] == "file:///workspace/ma-1/main.cpp" {
		t.Fatal("didChange URI was not mapped")
	}
}

func TestDidSaveUpdate(t *testing.T) {
	m, root := testMapper(t)
	raw := []byte(`{"jsonrpc":"2.0","method":"textDocument/didSave","params":{"textDocument":{"uri":"file:///workspace/ma-1/main.cpp"},"text":"final"}}`)
	_, update, err := ClientToServer(raw, m)
	if err != nil {
		t.Fatal(err)
	}
	if update == nil || !update.IsSave || !update.HasText || string(update.Text) != "final" ||
		update.Path != filepath.Join(root, "ma-1", "main.cpp") {
		t.Fatalf("unexpected update: %+v", update)
	}
}

func TestServerToClientWorkspaceEdit(t *testing.T) {
	m, root := testMapper(t)
	realURI := RealPathURI(filepath.Join(root, "ma-1", "main.cpp"))
	msg := `{"jsonrpc":"2.0","id":2,"result":{"changes":{"` + realURI + `":[{"range":{"start":{"line":0,"character":0},"end":{"line":0,"character":0}},"newText":"file:///workspace/keep /workspace/keep"}]}}}`
	out, err := ServerToClient([]byte(msg), m)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	result := parsed["result"].(map[string]any)
	changes := result["changes"].(map[string]any)
	if _, ok := changes["file:///workspace/ma-1/main.cpp"]; !ok {
		t.Fatalf("changes keys = %v", changes)
	}
	edit := changes["file:///workspace/ma-1/main.cpp"].([]any)[0].(map[string]any)
	if edit["newText"] != "file:///workspace/keep /workspace/keep" {
		t.Fatalf("newText was modified: %v", edit["newText"])
	}
}

func TestServerToClientDocumentChangesAndDiagnostics(t *testing.T) {
	m, root := testMapper(t)
	realURI := RealPathURI(filepath.Join(root, "ma-1", "main.cpp"))
	outside := filepath.Join(string(filepath.Separator), "opt", "include", "vector")
	outsideURI := RealPathURI(outside)

	input := `{"jsonrpc":"2.0","method":"textDocument/publishDiagnostics","params":{"uri":"` + realURI + `","diagnostics":[{"message":"ok","relatedInformation":[{"location":{"uri":"` + outsideURI + `"}}]}]}}`
	out, err := ServerToClient([]byte(input), m)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	params := parsed["params"].(map[string]any)
	if params["uri"] != "file:///workspace/ma-1/main.cpp" {
		t.Fatalf("diagnostic uri = %v", params["uri"])
	}
	diag := params["diagnostics"].([]any)[0].(map[string]any)
	loc := diag["relatedInformation"].([]any)[0].(map[string]any)["location"].(map[string]any)
	toolchain, ok := loc["uri"].(string)
	if !ok || !strings.HasPrefix(toolchain, "file:///toolchain/") {
		t.Fatalf("related uri = %v", loc["uri"])
	}
	back, ok := m.ToolchainRealPath(toolchain)
	if !ok || back != outside {
		t.Fatalf("toolchain round trip = %q, %v", back, ok)
	}
}

func TestServerToClientPreservesDocumentation(t *testing.T) {
	m, _ := testMapper(t)
	input := `{"jsonrpc":"2.0","id":3,"result":{"contents":{"kind":"markdown","value":"file:///workspace/x /workspace/y"},"label":"/workspace/label"}}`
	out, err := ServerToClient([]byte(input), m)
	if err != nil {
		t.Fatal(err)
	}
	if string(out) != input {
		t.Fatalf("message without URI roles changed:\n got %s\nwant %s", out, input)
	}
}

func TestCompilationDatabaseMapping(t *testing.T) {
	m, root := testMapper(t)
	raw := []byte(`{"jsonrpc":"2.0","method":"workspace/didChangeConfiguration","params":{"settings":{"compilationDatabaseChanges":{"/workspace/ma-1/main.cpp":{"workingDirectory":"/workspace/ma-1","compilationCommand":["clang++","-I/workspace/ma-1/include","-I","/workspace/ma-1/inc","-DROOT=/workspace/ma-1","/workspace/ma-1/main.cpp"]}}}}}`)
	out, _, err := ClientToServer(raw, m)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	settings := parsed["params"].(map[string]any)["settings"].(map[string]any)
	cdb := settings["compilationDatabaseChanges"].(map[string]any)
	realMain := filepath.Join(root, "ma-1", "main.cpp")
	entryValue, ok := cdb[realMain]
	if !ok {
		t.Fatalf("cdb keys = %v, want %q", cdb, realMain)
	}
	entry := entryValue.(map[string]any)
	if entry["workingDirectory"] != filepath.Join(root, "ma-1") {
		t.Fatalf("workingDirectory = %v", entry["workingDirectory"])
	}
	argv := entry["compilationCommand"].([]any)
	if argv[1] != "-I"+filepath.Join(root, "ma-1", "include") {
		t.Fatalf("joined -I arg = %v", argv[1])
	}
	if argv[3] != filepath.Join(root, "ma-1", "inc") {
		t.Fatalf("separated -I arg = %v", argv[3])
	}
	if argv[4] != "-DROOT=/workspace/ma-1" {
		t.Fatalf("define was modified: %v", argv[4])
	}
	if argv[5] != realMain {
		t.Fatalf("main operand = %v", argv[5])
	}
}

func TestExecuteCommandFileArgument(t *testing.T) {
	m, root := testMapper(t)
	raw := []byte(`{"jsonrpc":"2.0","id":4,"method":"workspace/executeCommand","params":{"command":"clangd.applyFix","arguments":[{"file":"file:///workspace/ma-1/main.cpp","id":"fix"}]}}`)
	out, _, err := ClientToServer(raw, m)
	if err != nil {
		t.Fatal(err)
	}
	var parsed map[string]any
	if err := json.Unmarshal(out, &parsed); err != nil {
		t.Fatal(err)
	}
	arg := parsed["params"].(map[string]any)["arguments"].([]any)[0].(map[string]any)
	want := RealPathURI(filepath.Join(root, "ma-1", "main.cpp"))
	if arg["file"] != want {
		t.Fatalf("file = %v, want %s", arg["file"], want)
	}
}

func TestMalformedMessageForwardedUnchanged(t *testing.T) {
	m, _ := testMapper(t)
	raw := []byte(`{not json`)
	out, update, err := ClientToServer(raw, m)
	if err == nil {
		t.Fatal("expected parse error")
	}
	if string(out) != string(raw) || update != nil {
		t.Fatalf("malformed message was changed")
	}
}
