package graph

import (
	"context"
	"github.com/neo4j/neo4j-go-driver/v5/neo4j"
)

type Neo4jStore struct {
	driver neo4j.Driver
}

func NewNeo4jStore(uri, user, pass string) (*Neo4jStore, error) {
	driver, err := neo4j.NewDriver(uri, neo4j.BasicAuth(user, pass, ""))
	if err != nil {
		return nil, err
	}
	if err := driver.VerifyConnectivity(); err != nil {
		return nil, err
	}
	return &Neo4jStore{driver: driver}, nil
}

func (s *Neo4jStore) Close() error {
	return s.driver.Close()
}

func (s *Neo4jStore) Run(ctx context.Context, query string, params map[string]interface{}) (neo4j.Result, error) {
	session := s.driver.NewSession(neo4j.SessionConfig{})
	defer session.Close()
	result, err := session.Run(query, params)
	return result, err
}

func (s *Neo4jStore) ExecuteTx(ctx context.Context, fn neo4j.TransactionWork) error {
	session := s.driver.NewSession(neo4j.SessionConfig{})
	defer session.Close()
	_, err := session.WriteTransaction(fn)
	return err
}
