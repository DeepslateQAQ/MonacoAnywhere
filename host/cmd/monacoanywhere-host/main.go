package main

import (
	"errors"
	"flag"
	"fmt"
	"os"
	"path/filepath"
	"regexp"

	"github.com/DeepslateQAQ/MonacoAnywhere/host/internal/install"
	"github.com/DeepslateQAQ/MonacoAnywhere/host/internal/nmsg"
	"github.com/DeepslateQAQ/MonacoAnywhere/host/internal/session"
)

// Set at build time with:
//
//	go build -ldflags "-X main.embeddedExtensionID=<id>"
var embeddedExtensionID = ""

var extensionIDPattern = regexp.MustCompile(`^[a-p]{32}$`)

func extensionID(explicit string) (string, error) {
	candidates := []string{explicit, os.Getenv("MONACOANYWHERE_EXTENSION_ID"), embeddedExtensionID}
	for _, candidate := range candidates {
		if candidate != "" {
			if !extensionIDPattern.MatchString(candidate) {
				return "", fmt.Errorf("invalid extension id %q", candidate)
			}
			return candidate, nil
		}
	}
	executable, err := os.Executable()
	if err == nil {
		bytes, readErr := os.ReadFile(filepath.Join(filepath.Dir(executable), "extension-id.txt"))
		if readErr == nil {
			candidate := string(bytes)
			if len(candidate) > 0 && candidate[len(candidate)-1] == '\n' {
				candidate = candidate[:len(candidate)-1]
			}
			if extensionIDPattern.MatchString(candidate) {
				return candidate, nil
			}
		}
	}
	return "", errors.New("extension id is unknown; build with -ldflags or pass --extension-id")
}

func splitList(value string) []string {
	if value == "" {
		return nil
	}
	var result []string
	start := 0
	for index := 0; index <= len(value); index++ {
		if index == len(value) || value[index] == ',' {
			item := value[start:index]
			if item != "" {
				result = append(result, item)
			}
			start = index + 1
		}
	}
	return result
}

func main() {
	if len(os.Args) > 1 {
		switch os.Args[1] {
		case "install":
			runInstall(os.Args[2:])
			return
		case "uninstall":
			runUninstall(os.Args[2:])
			return
		case "serve":
			runServe(os.Args[2:])
			return
		case "--version":
			fmt.Println("monacoanywhere-host")
			return
		}
	}
	runServe(nil)
}

func runInstall(args []string) {
	flags := flag.NewFlagSet("install", flag.ExitOnError)
	id := flags.String("extension-id", "", "Chromium extension ID")
	browsers := flags.String("browsers", "chrome,edge", "chrome,edge")
	flags.Parse(args)
	resolved, err := extensionID(*id)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}
	manifestPath, err := install.Install(resolved, splitList(*browsers))
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Installed native messaging host manifest:", manifestPath)
}

func runUninstall(args []string) {
	flags := flag.NewFlagSet("uninstall", flag.ExitOnError)
	browsers := flags.String("browsers", "chrome,edge", "chrome,edge")
	flags.Parse(args)
	if err := install.Uninstall(splitList(*browsers)); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println("Removed MonacoAnywhere native messaging registrations")
}

func runServe(args []string) {
	flags := flag.NewFlagSet("serve", flag.ExitOnError)
	id := flags.String("extension-id", "", "Chromium extension ID")
	clangd := flags.String("clangd", "", "clangd executable path")
	queryDrivers := flags.String("query-driver", "", "comma-separated query-driver globs")
	extraIncludes := flags.String("extra-include", "", "comma-separated extra header directories")
	flags.Parse(args)

	resolved, err := extensionID(*id)
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(2)
	}

	reader := nmsg.NewReader(os.Stdin)
	writer := nmsg.NewWriter(os.Stdout)
	var first struct {
		Type          string   `json:"type"`
		Protocol      int      `json:"protocol"`
		ClangdPath    string   `json:"clangdPath"`
		QueryDrivers  []string `json:"queryDriverGlobs"`
		ExtraIncludes []string `json:"extraIncludeDirs"`
	}
	if err := reader.Read(&first); err != nil {
		fmt.Fprintln(os.Stderr, "monacoanywhere-host: could not read native message:", err)
		os.Exit(1)
	}
	if first.Type == "ma/probe" {
		response := map[string]any{"type": "ma/probe-ok", "protocol": 1}
		_ = writer.Write(response)
		return
	}
	if first.Type != "ma/start" {
		_ = writer.Write(map[string]any{"type": "ma/error", "code": "expected-start"})
		return
	}

	options := session.StartOptions{
		ExtensionID:   resolved,
		ClangdPath:    *clangd,
		QueryDrivers:  append(splitList(*queryDrivers), first.QueryDrivers...),
		ExtraIncludes: append(splitList(*extraIncludes), first.ExtraIncludes...),
	}
	if options.ClangdPath == "" {
		options.ClangdPath = first.ClangdPath
	}
	active, ready, err := session.Start(options)
	if err != nil {
		_ = writer.Write(map[string]any{"type": "ma/error", "code": err.Error()})
		return
	}
	if err := writer.Write(ready); err != nil {
		active.Stop()
		return
	}

	stopRequested := make(chan struct{})
	go func() {
		var message struct {
			Type string `json:"type"`
		}
		for {
			if err := reader.Read(&message); err != nil {
				close(stopRequested)
				return
			}
			if message.Type == "ma/stop" {
				close(stopRequested)
				return
			}
		}
	}()
	<-stopRequested
	active.Stop()
}
