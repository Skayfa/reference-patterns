package protected

import "testing"

func TestAuthorizedGlobMatching(t *testing.T) {
	cases := []struct {
		role, permission string
		want             bool
	}{
		// user grants: profile.read, notes.*, bookmarks.*
		{"user", "notes.write", true},
		{"user", "notes.read", true},
		{"user", "notes.archive", true}, // a new permission, auto-covered by notes.*
		{"user", "bookmarks.delete", true},
		{"user", "profile.read", true},
		{"user", "admin.diagnostics", false},
		{"user", "admin.notes.delete_any", false}, // elevated: outside notes.*
		{"user", "billing.read", false},
		// admin grants: * — everything, including future permissions
		{"admin", "notes.write", true},
		{"admin", "admin.notes.delete_any", true},
		{"admin", "anything.at.all", true},
		// case-insensitive role, matching Rust/TS
		{"Admin", "admin.diagnostics", true},
		// unknown role has no grants
		{"intruder", "notes.read", false},
	}
	for _, c := range cases {
		if got := Authorized(c.role, c.permission); got != c.want {
			t.Errorf("Authorized(%q, %q) = %v, want %v", c.role, c.permission, got, c.want)
		}
	}
}
