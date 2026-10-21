# go-sync-overlay

Files here are copied over `vendor/go-sync/` by `hack/vendor.sh`, at the same
relative path. Use it for code we add to go-sync for the dev server: the SQLite
datastore under `datastore/sqlite/`, and the small wiring change that selects it.
The overlay never deletes vendor files.
