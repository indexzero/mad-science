package datastoretest

import (
	"fmt"
	"os"
	"path/filepath"

	"github.com/brave/go-sync/cache"
	sqlitecache "github.com/brave/go-sync/cache/sqlite"
	"github.com/brave/go-sync/datastore"
	"github.com/brave/go-sync/datastore/sqlite"
)

// UseSQLite reports whether tests run against the SQLite backend
// (SYNC_BACKEND=sqlite) instead of dynamo-local and Redis.
func UseSQLite() bool {
	return os.Getenv("SYNC_BACKEND") == "sqlite"
}

// tempDBPath returns a fresh database file for one test process. Tests never
// use SQLITE_PATH: ResetTable drops tables, and a dev database must survive.
func tempDBPath(name string) (string, error) {
	dir, err := os.MkdirTemp("", "go-sync-test-")
	if err != nil {
		return "", fmt.Errorf("error creating temp dir for sqlite test database: %w", err)
	}
	return filepath.Join(dir, name), nil
}

// NewDatastore returns the datastore under test: SQLite if UseSQLite, else
// Dynamo, configured from the environment as before.
func NewDatastore() (datastore.Datastore, error) {
	if !UseSQLite() {
		return datastore.NewDynamo()
	}
	path, err := tempDBPath("datastore.db")
	if err != nil {
		return nil, err
	}
	return sqlite.Open(path)
}

// NewRedisClient returns the cache client under test: SQLite if UseSQLite,
// else Redis, configured from the environment as before.
func NewRedisClient() cache.RedisClient {
	if !UseSQLite() {
		return cache.NewRedisClient()
	}
	path, err := tempDBPath("cache.db")
	if err != nil {
		panic(err)
	}
	c, err := sqlitecache.Open(path)
	if err != nil {
		panic(err)
	}
	return c
}
