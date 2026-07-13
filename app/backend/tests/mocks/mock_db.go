package mocks

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"fmt"
	"io"
)

// MockDB is a mock implementation of *sql.DB
type MockDB struct {
	QueryContextFunc      func(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error)
	QueryFunc             func(query string, args ...interface{}) (*sql.Rows, error)
	QueryRowContextFunc   func(ctx context.Context, query string, args ...interface{}) *sql.Row
	QueryRowFunc          func(query string, args ...interface{}) *sql.Row
	ExecContextFunc       func(ctx context.Context, query string, args ...interface{}) (sql.Result, error)
	ExecFunc              func(query string, args ...interface{}) (sql.Result, error)
	BeginTxFunc           func(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error)
	BeginFunc             func() (*sql.Tx, error)
	CloseFunc             func() error
	ConnFunc              func() (*sql.Conn, error)
	PingContextFunc       func(ctx context.Context) error
	PingFunc              func() error
	SetMaxIdleConnsFunc   func(n int)
	SetMaxOpenConnsFunc   func(n int)
	SetConnMaxLifetimeFunc func(d int)
}

// QueryContext executes a query that returns rows, with support for context cancellation.
func (m *MockDB) QueryContext(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	if m.QueryContextFunc != nil {
		return m.QueryContextFunc(ctx, query, args...)
	}
	// Return nil rows - caller must provide proper implementation
	return nil, nil
}

// Query executes a query that returns rows.
func (m *MockDB) Query(query string, args ...interface{}) (*sql.Rows, error) {
	if m.QueryFunc != nil {
		return m.QueryFunc(query, args...)
	}
	// Return nil rows - caller must provide proper implementation
	return nil, nil
}

// QueryRowContext executes a query that is expected to return at most one row.
func (m *MockDB) QueryRowContext(ctx context.Context, query string, args ...interface{}) *sql.Row {
	if m.QueryRowContextFunc != nil {
		return m.QueryRowContextFunc(ctx, query, args...)
	}
	// Return nil - caller must provide proper implementation
	return nil
}

// QueryRow executes a query that is expected to return at most one row.
func (m *MockDB) QueryRow(query string, args ...interface{}) *sql.Row {
	if m.QueryRowFunc != nil {
		return m.QueryRowFunc(query, args...)
	}
	// Return nil - caller must provide proper implementation
	return nil
}

// ExecContext executes a query without returning any rows, with context support.
func (m *MockDB) ExecContext(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	if m.ExecContextFunc != nil {
		return m.ExecContextFunc(ctx, query, args...)
	}
	return &MockResult{LastInsertIDValue: 1, RowsAffectedValue: 1}, nil
}

// Exec executes a query without returning any rows.
func (m *MockDB) Exec(query string, args ...interface{}) (sql.Result, error) {
	if m.ExecFunc != nil {
		return m.ExecFunc(query, args...)
	}
	return &MockResult{LastInsertIDValue: 1, RowsAffectedValue: 1}, nil
}

// BeginTx starts a transaction with TxOptions.
func (m *MockDB) BeginTx(ctx context.Context, opts *sql.TxOptions) (*sql.Tx, error) {
	if m.BeginTxFunc != nil {
		return m.BeginTxFunc(ctx, opts)
	}
	return nil, fmt.Errorf("BeginTx not implemented")
}

// Begin starts a transaction.
func (m *MockDB) Begin() (*sql.Tx, error) {
	if m.BeginFunc != nil {
		return m.BeginFunc()
	}
	return nil, fmt.Errorf("Begin not implemented")
}

// Close closes the database.
func (m *MockDB) Close() error {
	if m.CloseFunc != nil {
		return m.CloseFunc()
	}
	return nil
}

// Conn returns a single connection from the connection pool.
func (m *MockDB) Conn(ctx context.Context) (*sql.Conn, error) {
	if m.ConnFunc != nil {
		return m.ConnFunc()
	}
	return nil, fmt.Errorf("Conn not implemented")
}

// PingContext verifies a connection to the database is still alive.
func (m *MockDB) PingContext(ctx context.Context) error {
	if m.PingContextFunc != nil {
		return m.PingContextFunc(ctx)
	}
	return nil
}

// Ping verifies a connection to the database is still alive.
func (m *MockDB) Ping() error {
	if m.PingFunc != nil {
		return m.PingFunc()
	}
	return nil
}

// SetMaxIdleConns sets the maximum number of connections in the idle connection pool.
func (m *MockDB) SetMaxIdleConns(n int) {
	if m.SetMaxIdleConnsFunc != nil {
		m.SetMaxIdleConnsFunc(n)
	}
}

// SetMaxOpenConns sets the maximum number of open connections to the database.
func (m *MockDB) SetMaxOpenConns(n int) {
	if m.SetMaxOpenConnsFunc != nil {
		m.SetMaxOpenConnsFunc(n)
	}
}

// SetConnMaxLifetime sets the maximum amount of time a connection may be reused.
func (m *MockDB) SetConnMaxLifetime(d int) {
	if m.SetConnMaxLifetimeFunc != nil {
		m.SetConnMaxLifetimeFunc(d)
	}
}

// MockResult is a mock implementation of sql.Result
type MockResult struct {
	LastInsertIDValue int64
	RowsAffectedValue int64
	Error             error
}

func (m *MockResult) LastInsertId() (int64, error) {
	return m.LastInsertIDValue, m.Error
}

func (m *MockResult) RowsAffected() (int64, error) {
	return m.RowsAffectedValue, m.Error
}

// MockRows is a mock implementation of sql.Rows
type MockRows struct {
	data   [][]interface{}
	index  int
	closed bool
	err    error
}

func NewMockRows(data [][]interface{}) *MockRows {
	return &MockRows{
		data:  data,
		index: -1,
	}
}

func (m *MockRows) Columns() ([]string, error) {
	return []string{}, nil
}

func (m *MockRows) Scan(dest ...interface{}) error {
	if m.index < 0 || m.index >= len(m.data) {
		return io.EOF
	}
	if m.err != nil {
		return m.err
	}
	row := m.data[m.index]
	for i, v := range dest {
		if i < len(row) {
			*v.(*interface{}) = row[i]
		}
	}
	return nil
}

func (m *MockRows) Next() bool {
	if m.closed || m.err != nil {
		return false
	}
	m.index++
	return m.index < len(m.data)
}

func (m *MockRows) Err() error {
	return m.err
}

func (m *MockRows) Close() error {
	m.closed = true
	return nil
}

// MockRow is a mock implementation of sql.Row
type MockRow struct {
	data interface{}
	err  error
}

func NewMockRow(data interface{}) *MockRow {
	return &MockRow{data: data}
}

func (m *MockRow) Scan(dest ...interface{}) error {
	if m.err != nil {
		return m.err
	}
	if data, ok := m.data.([]interface{}); ok {
		for i, v := range dest {
			if i < len(data) {
				switch dv := v.(type) {
				case *interface{}:
					*dv = data[i]
				case *int64:
					if val, ok := data[i].(int64); ok {
						*dv = val
					}
				case *string:
					if val, ok := data[i].(string); ok {
						*dv = val
					}
				case *float64:
					if val, ok := data[i].(float64); ok {
						*dv = val
					}
				}
			}
		}
	}
	return nil
}

// MockScanner implements sql.Scanner for testing
type MockScanner struct {
	Value interface{}
	Err   error
}

func (m *MockScanner) Scan(src interface{}) error {
	if m.Err != nil {
		return m.Err
	}
	m.Value = src
	return nil
}

// MockValuerImpl implements driver.Valuer for testing
type MockValuerImpl struct {
	ValueData interface{}
	Err       error
}

func (m *MockValuerImpl) Value() (driver.Value, error) {
	return m.ValueData, m.Err
}
