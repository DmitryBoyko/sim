# Stage 1: build frontend
FROM node:20-alpine AS frontend
WORKDIR /app/web
COPY web/package.json web/package-lock.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: build Go binary
FROM golang:1.25-alpine AS backend
WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -o /server ./cmd/server

# Stage 3: runtime
FROM alpine:3.19
RUN apk add --no-cache ca-certificates
WORKDIR /app
COPY --from=backend /server .
COPY --from=frontend /app/web/dist ./web/dist
COPY --from=backend /app/README.md ./
COPY --from=backend /app/docs ./docs/
EXPOSE 3000
ENV HTTP_PORT=3000
ENTRYPOINT ["./server"]
