package protected

import (
	"testing"

	"google.golang.org/protobuf/reflect/protoreflect"

	authv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/auth/v1"
	bookmarkv1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/bookmark/v1"
	demov1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/demo/v1"
	notev1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/note/v1"
)

// The default-deny gate: EVERY RPC in the contract must carry an explicit
// (auth.v1.access) rule — public or a minimum role. A new RPC without one
// fails this test instead of silently shipping an unprotected endpoint.
func TestEveryRPCDeclaresAnAccessRule(t *testing.T) {
	files := []protoreflect.FileDescriptor{
		authv1.File_auth_v1_auth_proto,
		bookmarkv1.File_bookmark_v1_bookmark_proto,
		demov1.File_demo_v1_protected_proto,
		notev1.File_note_v1_note_proto,
	}
	for _, file := range files {
		services := file.Services()
		for i := 0; i < services.Len(); i++ {
			service := services.Get(i)
			methods := service.Methods()
			for j := 0; j < methods.Len(); j++ {
				method := methods.Get(j)
				procedure := "/" + string(service.FullName()) + "/" + string(method.Name())
				if AccessRuleFor(procedure) == nil {
					t.Errorf("%s has no (auth.v1.access) rule — annotate it public or with a minimum_role", procedure)
				}
			}
		}
	}
}

func TestRoleHierarchy(t *testing.T) {
	if RoleLevel("admin") <= RoleLevel("user") {
		t.Error("admin must outrank user")
	}
	if RoleLevel("intruder") != authv1.Role_ROLE_UNSPECIFIED {
		t.Error("unknown claims must map to ROLE_UNSPECIFIED")
	}
}
