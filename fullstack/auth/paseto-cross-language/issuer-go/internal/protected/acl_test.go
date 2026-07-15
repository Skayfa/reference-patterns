package protected

import (
	"testing"

	authv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1"
)

func TestRoleHierarchy(t *testing.T) {
	if RoleLevel("admin") <= RoleLevel("user") {
		t.Error("admin must outrank user")
	}
	if RoleLevel("intruder") != authv1.Role_ROLE_UNSPECIFIED {
		t.Error("unknown claims must map to ROLE_UNSPECIFIED")
	}
}
