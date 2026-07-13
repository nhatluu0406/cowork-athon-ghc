package embedding

import (
	"encoding/json"
	"reflect"
	"testing"
)

func TestParseChunkIDs_RoundTrip(t *testing.T) {
	want := []int64{1, 2, 3, 42}
	b, err := json.Marshal(want)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	got, err := parseChunkIDs(string(b))
	if err != nil {
		t.Fatalf("parseChunkIDs: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("parseChunkIDs(%q) = %v, want %v", b, got, want)
	}
}

func TestParseChunkIDs_Empty(t *testing.T) {
	got, err := parseChunkIDs("[]")
	if err != nil {
		t.Fatalf("parseChunkIDs: %v", err)
	}
	if len(got) != 0 {
		t.Errorf("parseChunkIDs([]) = %v, want empty", got)
	}
}

func TestParseChunkIDs_Invalid(t *testing.T) {
	if _, err := parseChunkIDs("not json"); err == nil {
		t.Error("expected error for invalid input, got nil")
	}
}
