// Package lspio implements LSP Content-Length framing for clangd's stdio.
package lspio

import (
	"bufio"
	"fmt"
	"io"
	"strconv"
	"strings"
	"sync"
)

const maxMessage = 64 * 1024 * 1024

type Conn struct {
	reader *bufio.Reader
	writer io.Writer
	mu     sync.Mutex
}

func New(reader io.Reader, writer io.Writer) *Conn {
	return &Conn{reader: bufio.NewReader(reader), writer: writer}
}

func (c *Conn) Read() ([]byte, error) {
	length := -1
	for {
		line, err := c.reader.ReadString('\n')
		if err != nil {
			return nil, err
		}
		line = strings.TrimRight(line, "\r\n")
		if line == "" {
			break
		}
		name, value, found := strings.Cut(line, ":")
		if !found {
			return nil, fmt.Errorf("malformed LSP header %q", line)
		}
		if strings.EqualFold(strings.TrimSpace(name), "Content-Length") {
			parsed, err := strconv.Atoi(strings.TrimSpace(value))
			if err != nil || parsed <= 0 || parsed > maxMessage {
				return nil, fmt.Errorf("invalid LSP Content-Length %q", value)
			}
			length = parsed
		}
	}
	if length < 0 {
		return nil, fmt.Errorf("LSP message has no Content-Length")
	}
	payload := make([]byte, length)
	if _, err := io.ReadFull(c.reader, payload); err != nil {
		return nil, err
	}
	return payload, nil
}

func (c *Conn) Write(payload []byte) error {
	if len(payload) == 0 || len(payload) > maxMessage {
		return fmt.Errorf("invalid LSP payload length %d", len(payload))
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	if _, err := fmt.Fprintf(c.writer, "Content-Length: %d\r\n\r\n", len(payload)); err != nil {
		return err
	}
	_, err := c.writer.Write(payload)
	return err
}
