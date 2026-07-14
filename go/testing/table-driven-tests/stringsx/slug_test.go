package stringsx

import "testing"

// assertEqual keeps failure messages consistent across cases.
// t.Helper() makes the failure point at the calling line, not this one.
func assertEqual(t *testing.T, got, want string) {
	t.Helper()
	if got != want {
		t.Errorf("got %q, want %q", got, want)
	}
}

func TestSlugify(t *testing.T) {
	t.Parallel()

	// Map keys name the cases: `go test -run 'TestSlugify/empty_input'`
	// targets a single one, and failures read as prose.
	tests := map[string]struct {
		in   string
		want string
	}{
		"simple words":          {in: "Hello World", want: "hello-world"},
		"already a slug":        {in: "hello-world", want: "hello-world"},
		"punctuation collapsed": {in: "Go: table-driven tests!", want: "go-table-driven-tests"},
		"leading trailing junk": {in: "  --Rust & Go--  ", want: "rust-go"},
		"digits kept":           {in: "Top 10 patterns", want: "top-10-patterns"},
		"empty input":           {in: "", want: ""},
	}

	for name, tc := range tests {
		t.Run(name, func(t *testing.T) {
			t.Parallel()
			assertEqual(t, Slugify(tc.in), tc.want)
		})
	}
}
