# Swagger docs (run from repo root)
.PHONY: generate build run
generate:
	go generate ./cmd/server

build: generate
	go build -o server.exe ./cmd/server

run: generate
	go run ./cmd/server
