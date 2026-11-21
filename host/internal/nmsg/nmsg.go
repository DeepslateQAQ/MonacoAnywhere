// Package nmsg implements Chrome's native messaging framing.
package nmsg

import (
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// MaxBrowserFrame is the largest frame Chrome accepts from a host.
const MaxBrowserFrame = 1024 * 1024

// Reader reads length-prefixed native messages from stdin.
type Reader struct {
	src io.Reader
}

func NewReader(src io.Reader) *Reader {
	return &Reader{src: src}
}

func (r *Reader) Read(value any) error {
	var header [4]byte
	if _, err := io.ReadFull(r.src, header[:]); err != nil {
		return err
	}
	size := binary.LittleEndian.Uint32(header[:])
	if size == 0 || size > 64*1024*1024 {
		return fmt.Errorf("native message length %d is invalid", size)
	}
	payload := make([]byte, size)
	if _, err := io.ReadFull(r.src, payload); err != nil {
		return err
	}
	if err := json.Unmarshal(payload, value); err != nil {
		return fmt.Errorf("invalid native message JSON: %w", err)
	}
	return nil
}

// Writer writes length-prefixed native messages to stdout.
type Writer struct {
	dst io.Writer
}

func NewWriter(dst io.Writer) *Writer {
	return &Writer{dst: dst}
}

func (w *Writer) Write(value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if len(payload) > MaxBrowserFrame {
		return errors.New("native message exceeds the 1 MiB browser limit")
	}
	var header [4]byte
	binary.LittleEndian.PutUint32(header[:], uint32(len(payload)))
	if _, err := w.dst.Write(header[:]); err != nil {
		return err
	}
	_, err = w.dst.Write(payload)
	return err
}
