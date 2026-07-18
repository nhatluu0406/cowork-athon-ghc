// Neo4j Schema and Index Creation for Knowledge Graph
// This file contains all Cypher statements for initializing the Neo4j graph structure
// per data-model.md §2.1

// Entity Node Labels and Properties
// ================================

// Person nodes
CREATE CONSTRAINT person_email IF NOT EXISTS FOR (p:Person) REQUIRE p.email IS UNIQUE;
CREATE INDEX person_display_name IF NOT EXISTS FOR (p:Person) ON (p.displayName);

// Project nodes
CREATE CONSTRAINT project_name IF NOT EXISTS FOR (p:Project) REQUIRE p.name IS UNIQUE;

// Document nodes
CREATE CONSTRAINT document_file_name IF NOT EXISTS FOR (d:Document) REQUIRE d.fileName IS UNIQUE;
CREATE INDEX document_source IF NOT EXISTS FOR (d:Document) ON (d.source);

// Technology nodes
CREATE CONSTRAINT technology_name IF NOT EXISTS FOR (t:Technology) REQUIRE t.name IS UNIQUE;

// Customer nodes
CREATE CONSTRAINT customer_name IF NOT EXISTS FOR (c:Customer) REQUIRE c.name IS UNIQUE;

// Department nodes
CREATE CONSTRAINT department_name IF NOT EXISTS FOR (d:Department) REQUIRE d.name IS UNIQUE;

// Chunk nodes
CREATE INDEX chunk_source_id IF NOT EXISTS FOR (c:Chunk) ON (c.sourceChunkId);
CREATE INDEX chunk_confidence IF NOT EXISTS FOR (c:Chunk) ON (c.confidence);

// Relationship Indices
// ====================

// Full-text search support
CREATE INDEX person_email_fulltext IF NOT EXISTS FOR (p:Person) ON EACH [p.email];
CREATE INDEX document_name_fulltext IF NOT EXISTS FOR (d:Document) ON EACH [d.fileName];
CREATE INDEX technology_name_fulltext IF NOT EXISTS FOR (t:Technology) ON EACH [t.name];

// Relationship type indices for common traversals
CREATE INDEX person_person_knows IF NOT EXISTS FOR ()-[r:KNOWS]-() WHERE r.confidence IS NOT NULL;
CREATE INDEX person_project_owns IF NOT EXISTS FOR ()-[r:OWNS]-() WHERE r.confidence IS NOT NULL;
CREATE INDEX document_technology_uses IF NOT EXISTS FOR ()-[r:USES]-() WHERE r.confidence IS NOT NULL;

// Node Count Indices (for statistics queries)
CREATE INDEX all_persons FOR (p:Person);
CREATE INDEX all_projects FOR (p:Project);
CREATE INDEX all_documents FOR (d:Document);
CREATE INDEX all_technologies FOR (t:Technology);
CREATE INDEX all_customers FOR (c:Customer);
CREATE INDEX all_departments FOR (d:Department);

// Verification Queries
// ====================

// Verify all constraints and indices were created
CALL db.indexes() YIELD name, state WHERE state = "ONLINE" RETURN count(*) AS online_indexes;
CALL db.constraints() YIELD name, state WHERE state = "ONLINE" RETURN count(*) AS online_constraints;
