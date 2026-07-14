// Package stringsx holds a small string helper used to demonstrate
// table-driven tests.
package stringsx

import "strings"

// Slugify turns an arbitrary title into a URL-safe slug: lower-case,
// alphanumerics kept, every other run of characters collapsed to one dash.
func Slugify(title string) string {
	var b strings.Builder
	prevDash := true // true at start so we never emit a leading dash
	for _, r := range strings.ToLower(title) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
			prevDash = false
		default:
			if !prevDash {
				b.WriteByte('-')
				prevDash = true
			}
		}
	}
	return strings.TrimSuffix(b.String(), "-")
}
