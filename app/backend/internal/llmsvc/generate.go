// Package llmsvc provides gRPC stubs for communicating with llm-svc
// This file serves as a holder for the go:generate directive.

//go:generate protoc --go_out=. --go_opt=paths=source_relative --go-grpc_out=. --go-grpc_opt=paths=source_relative ../../proto/llmsvc.proto

package llmsvc
