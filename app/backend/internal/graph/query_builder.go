package graph

import (
	"database/sql"

	neo4j "github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

// QueryBuilder executes graph and relational queries.
type QueryBuilder struct {
	db     *sql.DB
	driver neo4j.DriverWithContext
}

func NewQueryBuilder(db *sql.DB, driver neo4j.DriverWithContext) *QueryBuilder {
	return &QueryBuilder{db: db, driver: driver}
}
