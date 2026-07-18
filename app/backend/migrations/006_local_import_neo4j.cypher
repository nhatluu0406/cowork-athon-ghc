// Local folder import Neo4j schema
// Creates node constraints and optional indexes for local documents and sources

// Ensure unique LocalDocument nodes by local_file_id
CREATE CONSTRAINT local_doc_unique IF NOT EXISTS
    FOR (d:LocalDocument) REQUIRE d.local_file_id IS UNIQUE;

// Ensure unique LocalSource nodes by source_id
CREATE CONSTRAINT local_source_unique IF NOT EXISTS
    FOR (s:LocalSource) REQUIRE s.source_id IS UNIQUE;
