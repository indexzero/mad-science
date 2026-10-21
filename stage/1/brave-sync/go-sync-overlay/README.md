# go-sync-overlay

Files here are copied over `vendor/go-sync/` by `hack/vendor.sh`, at the same
relative path. Use it for code we add to go-sync for the dev server. The
overlay never deletes vendor files.

Changes to upstream files never go here as whole files. They go in
`go-sync.patch`, which `hack/vendor.sh` applies once with `git apply`. If the
patch is already applied, it is skipped. If it does not apply cleanly, vendor.sh
fails and leaves the checkout as is.

## The SQLite backend (dev only)

`SYNC_BACKEND=sqlite` makes the server use SQLite for both the datastore
(instead of DynamoDB) and the cache (instead of Redis), in one file at
`SQLITE_PATH` (default `./go-sync-dev.db`). Unset, the server behaves as
upstream. It is for testing only and never holds real sync data.

- `internal/sqlitedb/`: opens the shared database file.
- `datastore/sqlite/`: `datastore.Datastore`, a line-by-line port of the Dynamo
  implementation in `datastore/sync_entity.go` and `datastore/item_count.go`.
- `cache/sqlite/`: `cache.RedisClient` with TTL expiry.
- `server/backend.go`: picks the backend from the environment.
- `datastore/datastoretest/backend.go`: lets upstream's tests pick the backend.
  With `SYNC_BACKEND=sqlite` they run against a fresh temporary file, never
  `SQLITE_PATH`.
- `cmd/sqlite-inspect/`: read-only summary of a store, used by `hack/dev.sh sqlite`.
- `go-sync.patch`: the server.go wiring, the test helper and test setup changes,
  and the `modernc.org/sqlite` dependency (pure Go, no cgo).

Run upstream's tests against SQLite:

    cd vendor/go-sync && SYNC_BACKEND=sqlite GOFLAGS=-p=2 go test ./datastore/... ./command/...
