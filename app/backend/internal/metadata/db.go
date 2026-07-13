package metadata

import (
	"context"
	"database/sql"
	_ "github.com/lib/pq"
)

type DB struct {
	conn *sql.DB
}

func New(dbURL string) (*DB, error) {
	conn, err := sql.Open("postgres", dbURL)
	if err != nil {
		return nil, err
	}
	if err := conn.Ping(); err != nil {
		return nil, err
	}
	conn.SetMaxOpenConns(25)
	conn.SetMaxIdleConns(5)
	return &DB{conn: conn}, nil
}

func (d *DB) Close() error {
	return d.conn.Close()
}

// Conn returns the underlying *sql.DB for packages that depend on the
// standard library type directly (e.g. internal/feedback, internal/finetuning).
func (d *DB) Conn() *sql.DB {
	return d.conn
}

func (d *DB) WithTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := d.conn.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		tx.Rollback()
		return err
	}
	return tx.Commit()
}

func (d *DB) QueryRow(ctx context.Context, query string, args ...interface{}) *sql.Row {
	return d.conn.QueryRowContext(ctx, query, args...)
}

func (d *DB) Query(ctx context.Context, query string, args ...interface{}) (*sql.Rows, error) {
	return d.conn.QueryContext(ctx, query, args...)
}

func (d *DB) Exec(ctx context.Context, query string, args ...interface{}) (sql.Result, error) {
	return d.conn.ExecContext(ctx, query, args...)
}
