// Package sqlitedb opens the SQLite file that backs the dev server. The
// datastore and the cache share one file and one *sql.DB.
//
// This backend is for local testing only. It never holds real sync data.
package sqlitedb

import (
	"database/sql"
	"fmt"
	"net/url"

	_ "modernc.org/sqlite" // pure-Go driver, registers "sqlite"
)

// DefaultPath is used when SQLITE_PATH is unset.
const DefaultPath = "./go-sync-dev.db"

// Open opens (and creates, unless readOnly) the SQLite database at path.
//
// The pool holds a single connection. Every statement and transaction is
// serialized, so there is no SQLITE_BUSY and no lock upgrade deadlock. A dev
// server does not need more.
func Open(path string, readOnly bool) (*sql.DB, error) {
	q := url.Values{}
	q.Add("_pragma", "busy_timeout(5000)")
	if readOnly {
		q.Add("mode", "ro")
	} else {
		q.Add("_pragma", "journal_mode(WAL)")
		q.Add("_pragma", "synchronous(NORMAL)")
	}
	dsn := "file:" + path + "?" + q.Encode()

	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, fmt.Errorf("error opening sqlite database %s: %w", path, err)
	}
	db.SetMaxOpenConns(1)
	db.SetMaxIdleConns(1)
	db.SetConnMaxLifetime(0)
	if err := db.Ping(); err != nil {
		_ = db.Close()
		return nil, fmt.Errorf("error opening sqlite database %s: %w", path, err)
	}
	return db, nil
}
