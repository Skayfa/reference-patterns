// Package note implements note.v1.NoteService — the "new entity" walkthrough.
// The interceptor already authenticated the caller and enforced the RPC's
// minimum role (from the proto); this file is only business logic: notes are
// scoped to the token's subject, deletion is owner-or-admin.
package note

import (
	"context"
	"errors"

	"connectrpc.com/connect"

	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/protected"
	"github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/internal/store"
	notev1 "github.com/Skayfa/reference-patterns/fullstack/auth/paseto-cross-language/issuer-go/pb/note/v1"
)

type Service struct {
	store *store.Store
}

func NewService(st *store.Store) *Service {
	return &Service{store: st}
}

func apiNote(n store.Note) *notev1.Note {
	return &notev1.Note{Id: n.ID, Text: n.Text, CreatedAt: n.CreatedAt}
}

func (s *Service) CreateNote(
	ctx context.Context, req *connect.Request[notev1.CreateNoteRequest],
) (*connect.Response[notev1.CreateNoteResponse], error) {
	claims, err := protected.ClaimsFrom(ctx)
	if err != nil {
		return nil, err
	}
	// Text shape (1..500 chars) was already enforced by protovalidate.
	created, err := s.store.CreateNote(ctx, claims.Subject, req.Msg.GetText())
	if err != nil {
		return nil, err
	}
	return connect.NewResponse(&notev1.CreateNoteResponse{Note: apiNote(created)}), nil
}

func (s *Service) ListNotes(
	ctx context.Context, _ *connect.Request[notev1.ListNotesRequest],
) (*connect.Response[notev1.ListNotesResponse], error) {
	claims, err := protected.ClaimsFrom(ctx)
	if err != nil {
		return nil, err
	}
	notes, err := s.store.NotesByUser(ctx, claims.Subject)
	if err != nil {
		return nil, err
	}
	res := &notev1.ListNotesResponse{Notes: make([]*notev1.Note, len(notes))}
	for i, n := range notes {
		res.Notes[i] = apiNote(n)
	}
	return connect.NewResponse(res), nil
}

func (s *Service) DeleteNote(
	ctx context.Context, req *connect.Request[notev1.DeleteNoteRequest],
) (*connect.Response[notev1.DeleteNoteResponse], error) {
	claims, err := protected.ClaimsFrom(ctx)
	if err != nil {
		return nil, err
	}
	existing, err := s.store.NoteByID(ctx, req.Msg.GetId())
	if errors.Is(err, store.ErrNotFound) {
		return nil, connect.NewError(connect.CodeNotFound, errors.New("note not found"))
	}
	if err != nil {
		return nil, err
	}
	// Ownership is business logic on top of the "notes.delete" gate the
	// interceptor already enforced: the owner may delete their own note;
	// deleting anyone's requires the elevated, contract-declared permission.
	isOwner := existing.UserID == claims.Subject
	if !isOwner && !protected.Authorized(claims.Role, "admin.notes.delete_any") {
		return nil, connect.NewError(connect.CodePermissionDenied,
			errors.New("permission required: admin.notes.delete_any"))
	}
	if err := s.store.DeleteNote(ctx, existing.ID); err != nil {
		return nil, err
	}
	return connect.NewResponse(&notev1.DeleteNoteResponse{}), nil
}
