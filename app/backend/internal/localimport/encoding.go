package localimport

import (
	"bytes"

	"github.com/saintfish/chardet"
	"golang.org/x/text/encoding/charmap"
	"golang.org/x/text/encoding/unicode"
	"golang.org/x/text/transform"
	"golang.org/x/text/encoding"
)

// DetectEncoding detects the character encoding of a byte sample.
// Returns charset name, confidence (0-1), and error if detection fails.
func DetectEncoding(sample []byte) (string, float64, error) {
	// Check for BOM (Byte Order Mark)
	if len(sample) >= 3 && bytes.HasPrefix(sample, []byte{0xEF, 0xBB, 0xBF}) {
		return "UTF-8", 1.0, nil
	}
	if len(sample) >= 2 {
		if bytes.HasPrefix(sample, []byte{0xFF, 0xFE}) {
			return "UTF-16-LE", 1.0, nil
		}
		if bytes.HasPrefix(sample, []byte{0xFE, 0xFF}) {
			return "UTF-16-BE", 1.0, nil
		}
	}

	// Try chardet on first 4KB
	if len(sample) > 4096 {
		sample = sample[:4096]
	}

	detector := chardet.NewTextDetector()
	result, err := detector.DetectBest(sample)
	if err == nil && result != nil && result.Confidence >= 70 {
		return result.Charset, float64(result.Confidence) / 100, nil
	}

	// Confidence too low; treat as binary
	return "", 0, nil
}

// ConvertToUTF8 converts byte data from the detected charset to UTF-8.
func ConvertToUTF8(data []byte, charset string) ([]byte, error) {
	switch charset {
	case "UTF-8":
		return data, nil
	case "UTF-16-LE":
		return decodeWithEncoding(data, unicode.UTF16(unicode.LittleEndian, unicode.UseBOM))
	case "UTF-16-BE":
		return decodeWithEncoding(data, unicode.UTF16(unicode.BigEndian, unicode.UseBOM))
	case "ISO-8859-1":
		return decodeWithEncoding(data, charmap.ISO8859_1)
	case "windows-1252":
		return decodeWithEncoding(data, charmap.Windows1252)
	default:
		// Try UTF-8 as fallback
		return data, nil
	}
}

// decodeWithEncoding transforms data using the given encoding.
func decodeWithEncoding(data []byte, enc encoding.Encoding) ([]byte, error) {
	decoder := enc.NewDecoder()
	result, _, err := transform.Bytes(decoder, data)
	return result, err
}
