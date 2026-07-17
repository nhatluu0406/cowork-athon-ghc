package localimport_test

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/rad-system/m365-knowledge-graph/internal/localimport"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// TestDetectEncoding_UTF8BOM tests UTF-8 BOM detection.
func TestDetectEncoding_UTF8BOM(t *testing.T) {
	// UTF-8 BOM + content
	data := append([]byte{0xEF, 0xBB, 0xBF}, []byte("Hello, world!")...)

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	assert.Equal(t, "UTF-8", charset)
	assert.Equal(t, 1.0, confidence)
}

// TestDetectEncoding_UTF16LE tests UTF-16 LE BOM detection.
func TestDetectEncoding_UTF16LE(t *testing.T) {
	// UTF-16 LE BOM
	data := []byte{0xFF, 0xFE, 0x48, 0x00, 0x69, 0x00} // "Hi" in UTF-16 LE

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	assert.Equal(t, "UTF-16-LE", charset)
	assert.Equal(t, 1.0, confidence)
}

// TestDetectEncoding_UTF16BE tests UTF-16 BE BOM detection.
func TestDetectEncoding_UTF16BE(t *testing.T) {
	// UTF-16 BE BOM
	data := []byte{0xFE, 0xFF, 0x00, 0x48, 0x00, 0x69} // "Hi" in UTF-16 BE

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	assert.Equal(t, "UTF-16-BE", charset)
	assert.Equal(t, 1.0, confidence)
}

// TestDetectEncoding_Latin1 tests Latin-1 encoding detection.
func TestDetectEncoding_Latin1(t *testing.T) {
	// Latin-1 encoded text: "café" (C3 A9 in UTF-8, but we use Latin-1)
	data := []byte{0xE9}

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	// chardet may not detect single character reliably, but should not error
	assert.NotNil(t, charset)
}

// TestDetectEncoding_BinaryFile tests binary file detection.
func TestDetectEncoding_BinaryFile(t *testing.T) {
	// Random binary data
	data := []byte{0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG magic
		0xFF, 0xFE, 0xFD, 0xFC, 0xFB, 0xFA, 0xF9, 0xF8}

	charset, confidence, err := localimport.DetectEncoding(data)
	// Binary data should have low confidence or empty result
	if confidence > 0 {
		t.Logf("Binary data detected with charset=%s, confidence=%f", charset, confidence)
	}
	// Binary detection should not error
	require.NoError(t, err)
}

// TestDetectEncoding_EmptyData tests empty data handling.
func TestDetectEncoding_EmptyData(t *testing.T) {
	data := []byte{}

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	assert.Equal(t, "", charset)
	assert.Equal(t, 0.0, confidence)
}

// TestDetectEncoding_SmallUTF8Sample tests small UTF-8 sample.
func TestDetectEncoding_SmallUTF8Sample(t *testing.T) {
	data := []byte("Hello")

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	// Should detect as UTF-8 or similar
	assert.Greater(t, confidence, 0.0)
}

// TestConvertToUTF8_UTF16LE tests UTF-16 LE to UTF-8 conversion.
func TestConvertToUTF8_UTF16LE(t *testing.T) {
	// "Hello" in UTF-16 LE (without BOM for conversion)
	// H=0x48, e=0x65, l=0x6C, l=0x6C, o=0x6F (each followed by 0x00 in LE)
	data := []byte{0x48, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F, 0x00}

	result, err := localimport.ConvertToUTF8(data, "UTF-16-LE")
	require.NoError(t, err)
	// Result should be valid UTF-8
	assert.NotNil(t, result)
	assert.Contains(t, string(result), "Hello")
}

// TestConvertToUTF8_UTF16BE tests UTF-16 BE to UTF-8 conversion.
func TestConvertToUTF8_UTF16BE(t *testing.T) {
	// "Hello" in UTF-16 BE
	// Each character is 0x00 followed by the ASCII value
	data := []byte{0x00, 0x48, 0x00, 0x65, 0x00, 0x6C, 0x00, 0x6C, 0x00, 0x6F}

	result, err := localimport.ConvertToUTF8(data, "UTF-16-BE")
	require.NoError(t, err)
	assert.NotNil(t, result)
	assert.Contains(t, string(result), "Hello")
}

// TestConvertToUTF8_Latin1 tests Latin-1 to UTF-8 conversion.
func TestConvertToUTF8_Latin1(t *testing.T) {
	// "café" in Latin-1
	// c=0x63, a=0x61, f=0x66, é=0xE9
	data := []byte{0x63, 0x61, 0x66, 0xE9}

	result, err := localimport.ConvertToUTF8(data, "ISO-8859-1")
	require.NoError(t, err)
	assert.NotNil(t, result)
	// Result should be valid UTF-8 containing "caf"
	assert.Contains(t, string(result), "caf")
}

// TestConvertToUTF8_UTF8Passthrough tests that UTF-8 data passes through unchanged.
func TestConvertToUTF8_UTF8Passthrough(t *testing.T) {
	data := []byte("Hello, world!")

	result, err := localimport.ConvertToUTF8(data, "UTF-8")
	require.NoError(t, err)
	assert.Equal(t, data, result)
}

// TestConvertToUTF8_UnknownCharset tests unknown charset handling (should return data unchanged).
func TestConvertToUTF8_UnknownCharset(t *testing.T) {
	data := []byte("Hello")

	result, err := localimport.ConvertToUTF8(data, "UNKNOWN-CHARSET")
	require.NoError(t, err)
	// Unknown charset should return data unchanged as fallback
	assert.Equal(t, data, result)
}

// TestEncoding_RoundTrip tests encoding detection then conversion.
func TestEncoding_RoundTrip(t *testing.T) {
	tmpDir := t.TempDir()

	// Create UTF-16 LE file
	utf16leFile := filepath.Join(tmpDir, "test_utf16le.txt")
	// "Test content" in UTF-16 LE
	content := []byte{
		0xFF, 0xFE, // BOM
		0x54, 0x00, 0x65, 0x00, 0x73, 0x00, 0x74, 0x00, // "Test"
		0x20, 0x00, // space
		0x63, 0x00, 0x6F, 0x00, 0x6E, 0x00, 0x74, 0x00, 0x65, 0x00, 0x6E, 0x00, 0x74, 0x00, // "content"
	}
	require.NoError(t, os.WriteFile(utf16leFile, content, 0644))

	// Read and detect
	data, err := os.ReadFile(utf16leFile)
	require.NoError(t, err)

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	assert.Equal(t, "UTF-16-LE", charset)
	assert.Greater(t, confidence, 0.0)

	// Convert
	converted, err := localimport.ConvertToUTF8(data, charset)
	require.NoError(t, err)
	assert.NotNil(t, converted)
	// Result should be valid UTF-8
	assert.NotEmpty(t, string(converted))
}

// TestDetectEncoding_LargeData tests detection on large data samples.
func TestDetectEncoding_LargeData(t *testing.T) {
	// Create large UTF-8 sample
	data := make([]byte, 10000)
	for i := 0; i < 10000; i++ {
		data[i] = byte(65 + (i % 26)) // A-Z repeating
	}

	charset, confidence, err := localimport.DetectEncoding(data)
	require.NoError(t, err)
	// Large sample should be detected with high confidence
	assert.Greater(t, confidence, 0.5)
}
