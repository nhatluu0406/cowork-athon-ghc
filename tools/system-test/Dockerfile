# Dockerfile for m365kg system tests
# Includes all prerequisites: PostgreSQL, Neo4j, Go, Rust, Node, protoc
FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive

# Use Japanese mirror for faster downloads
RUN sed -i 's|http://archive.ubuntu.com|http://ftp.jaist.ac.jp/pub/Linux|g' /etc/apt/sources.list
RUN sed -i 's|http://security.ubuntu.com|http://ftp.jaist.ac.jp/pub/Linux|g' /etc/apt/sources.list

# Update packages and install base dependencies
RUN apt-get update && apt-get install -y \
    build-essential \
    curl \
    wget \
    git \
    ca-certificates \
    gnupg \
    lsb-release \
    apt-transport-https \
    software-properties-common \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Install PostgreSQL 16 (includes initdb, pg_ctl, psql, createdb, pg_isready)
RUN apt-get update && apt-get install -y \
    postgresql \
    postgresql-client \
    postgresql-contrib \
    && rm -rf /var/lib/apt/lists/*

# Install Neo4j (add Neo4j's official repository first)
RUN curl -fsSL https://debian.neo4j.com/neotechnology.gpg.key | gpg --dearmor -o /usr/share/keyrings/neo4j.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/neo4j.gpg] https://debian.neo4j.com stable 5" | tee /etc/apt/sources.list.d/neo4j.list && \
    apt-get update && apt-get install -y neo4j && \
    rm -rf /var/lib/apt/lists/* && \
    systemctl disable neo4j 2>/dev/null || true

# Install Go (latest stable from golang.org)
RUN curl -fsSL https://go.dev/dl/go1.25.0.linux-amd64.tar.gz | tar -C /usr/local -xz

# Install Rust (via rustup)
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable --profile minimal

# Install Node.js 22
RUN curl -fsSL https://deb.nodesource.com/setup_22.x | bash - && \
    apt-get install -y nodejs && \
    rm -rf /var/lib/apt/lists/*

# Install protobuf compiler (needed by tonic-build in llm-svc build)
RUN apt-get update && apt-get install -y \
    protobuf-compiler \
    && rm -rf /var/lib/apt/lists/*

# PostgreSQL wrapper scripts — run.sh runs as root but postgres refuses root.
# These wrappers transparently drop to the 'postgres' system user for pg commands.
# This allows run.sh (which executes as root in the container) to manage PostgreSQL
# while PostgreSQL itself runs unprivileged.
RUN cat > /usr/local/bin/initdb <<'WRAPPER_EOF'
#!/bin/bash
# Drop to postgres user to run initdb with proper environment
exec su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/initdb $(printf '%q ' "$@")"
WRAPPER_EOF
RUN chmod +x /usr/local/bin/initdb

RUN cat > /usr/local/bin/pg_ctl <<'WRAPPER_EOF'
#!/bin/bash
# Drop to postgres user to run pg_ctl with proper environment
exec su postgres -s /bin/bash -c "/usr/lib/postgresql/16/bin/pg_ctl $(printf '%q ' "$@")"
WRAPPER_EOF
RUN chmod +x /usr/local/bin/pg_ctl

# Ensure /tmp is world-writable with sticky bit (standard security practice)
RUN chmod 1777 /tmp

# Set up PATH to include all binaries (Rust + Go + PostgreSQL bin dir at end)
# /usr/local/bin (where our postgres wrappers live) must come BEFORE /usr/lib/postgresql/16/bin
# so the wrappers are invoked instead of the raw postgres binaries that refuse to run as root
ENV PATH="/root/.cargo/bin:/usr/local/go/bin:${PATH}:/usr/lib/postgresql/16/bin"

# Allow go build to read VCS info from the mounted /workspace volume.
# Without this, docker volume ownership mismatches cause git to return
# "fatal: detected dubious ownership in repository" when run.sh (as root)
# tries to `go build`, resulting in VCS stamping failure.
RUN git config --global --add safe.directory '*'

# Create workspace directory
WORKDIR /workspace

# Entrypoint: run bash by default (allows docker run <image> ./scripts/system-test/run.sh)
ENTRYPOINT ["/bin/bash"]
