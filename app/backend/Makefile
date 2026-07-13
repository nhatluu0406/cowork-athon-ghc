.PHONY: help build test lint run docker-build docker-run clean smoke proto

help:
	@echo "m365-knowledge-graph - Make targets:"
	@echo "  make proto        - Generate gRPC code from proto/llmsvc.proto (T157-T158)"
	@echo "  make build        - Build the binary"
	@echo "  make test         - Run unit and integration tests"
	@echo "  make lint         - Run linters (gofmt, go vet, golangci-lint)"
	@echo "  make run          - Run the server"
	@echo "  make smoke        - Boot server against docker-compose PostgreSQL/Neo4j and curl every endpoint (T116)"
	@echo "  make docker-build - Build Docker image"
	@echo "  make docker-run   - Run Docker container (requires docker-compose up for PostgreSQL/Neo4j)"
	@echo "  make clean        - Clean build artifacts"

proto:
	@echo "Generating gRPC code from proto/llmsvc.proto (T157-T158)..."
	@mkdir -p internal/llmsvc
	@which protoc > /dev/null || (echo "protoc not found; install from https://github.com/protocolbuffers/protobuf/releases"; exit 1)
	@which protoc-gen-go > /dev/null || (echo "protoc-gen-go not found; run: go install google.golang.org/protobuf/cmd/protoc-gen-go@latest"; exit 1)
	@which protoc-gen-go-grpc > /dev/null || (echo "protoc-gen-go-grpc not found; run: go install google.golang.org/grpc/cmd/protoc-gen-go-grpc@latest"; exit 1)
	protoc --go_out=. --go_opt=paths=source_relative \
	       --go-grpc_out=. --go-grpc_opt=paths=source_relative \
	       proto/llmsvc.proto

build: proto
	@echo "Building m365-knowledge-graph..."
	go build -o bin/m365-knowledge-graph ./cmd

test:
	@echo "Running tests..."
	go test -v -race -cover ./...

lint:
	@echo "Running linters..."
	go fmt ./...
	go vet ./...
	@if command -v golangci-lint > /dev/null; then \
		golangci-lint run ./...; \
	else \
		echo "golangci-lint not installed; skipping"; \
	fi

run: build
	@echo "Starting m365-knowledge-graph..."
	./bin/m365-knowledge-graph

docker-build:
	@echo "Building Docker image..."
	docker build -t m365-knowledge-graph:latest .

docker-run:
	@echo "Running Docker container..."
	docker run -it --rm \
		-p 8080:8080 \
		--env-file .env \
		--network host \
		m365-knowledge-graph:latest

clean:
	@echo "Cleaning build artifacts..."
	rm -rf bin/
	go clean

deps:
	@echo "Installing dependencies..."
	go mod tidy
	go mod download

smoke:
	@echo "Running wiring smoke test (T116)..."
	./scripts/smoke-test.sh
