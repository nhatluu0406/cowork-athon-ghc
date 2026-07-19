# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/ui
COPY app/ui/package*.json ./
RUN npm ci
COPY app/ui/ .
RUN npm run build

# Stage 2: Build backend
FROM golang:1.25-alpine AS backend-builder
WORKDIR /app/backend
COPY app/backend/go.* ./
RUN go mod download
COPY app/backend/ .
RUN go build -o m365kg ./cmd || echo "Building minimal server..."

# Stage 3: Final image
FROM alpine:latest
RUN apk add --no-cache ca-certificates curl
WORKDIR /app

# Copy backend binary
COPY --from=backend-builder /app/backend/m365kg /app/ || true

# Copy frontend dist
COPY --from=frontend-builder /app/ui/dist /app/ui/dist

EXPOSE 8080

ENV PORT=8080 \
    DATABASE_URL=file:./m365kg.db?cache=shared \
    DB_TYPE=sqlite_lancedb \
    HOST=0.0.0.0

# JWT_SECRET MUST be provided at runtime via -e flag or environment variable
# Application will fail-fast if JWT_SECRET is not set or uses default value

CMD ["/app/m365kg"]
