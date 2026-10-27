package server

import (
	"os"

	"github.com/rs/zerolog/log"

	"github.com/brave/go-sync/cache"
	sqlitecache "github.com/brave/go-sync/cache/sqlite"
	"github.com/brave/go-sync/datastore"
	"github.com/brave/go-sync/datastore/sqlite"
	"github.com/brave/go-sync/internal/sqlitedb"
)

// newBackends returns the datastore and the cache client.
//
// SYNC_BACKEND=sqlite selects the dev-only SQLite backend for both, in one
// file at SQLITE_PATH (default ./go-sync-dev.db). Anything else keeps upstream
// behavior: DynamoDB and Redis, configured from the environment.
func newBackends() (datastore.Datastore, cache.RedisClient, error) {
	if os.Getenv("SYNC_BACKEND") != "sqlite" {
		db, err := datastore.NewDynamo()
		if err != nil {
			return nil, nil, err
		}
		return db, cache.NewRedisClient(), nil
	}

	path := os.Getenv("SQLITE_PATH")
	if path == "" {
		path = sqlitedb.DefaultPath
	}
	handle, err := sqlitedb.Open(path, false)
	if err != nil {
		return nil, nil, err
	}
	db, err := sqlite.New(handle)
	if err != nil {
		return nil, nil, err
	}
	redis, err := sqlitecache.New(handle)
	if err != nil {
		return nil, nil, err
	}
	log.Warn().Str("path", path).
		Msg("SYNC_BACKEND=sqlite: dev-only SQLite datastore and cache. Never use it for real sync data.")
	return db, redis, nil
}
