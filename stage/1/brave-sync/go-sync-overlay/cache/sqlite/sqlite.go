// Package sqlite is a cache.RedisClient over SQLite, for the go-sync dev
// server only. It keeps the Redis semantics go-sync relies on: SET with a TTL,
// INCR and DECR, GET and GETDEL, DEL and FLUSHALL. Expired keys read as
// missing, as in Redis.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/brave/go-sync/cache"
	"github.com/brave/go-sync/internal/sqlitedb"
)

const schema = `
CREATE TABLE IF NOT EXISTS cache_entries (
	key        TEXT    NOT NULL PRIMARY KEY,
	value      TEXT    NOT NULL,
	expires_at INTEGER -- unix milliseconds; NULL means no expiry
);
CREATE INDEX IF NOT EXISTS cache_entries_expires_at
	ON cache_entries (expires_at) WHERE expires_at IS NOT NULL;
`

// errNotInteger is the error Redis returns when INCR meets a non-integer.
var errNotInteger = errors.New("ERR value is not an integer or out of range")

// Client is a cache.RedisClient over SQLite.
type Client struct {
	db  *sql.DB
	now func() time.Time
}

var _ cache.RedisClient = (*Client)(nil)

// Open opens the SQLite file at path and returns a Client over it.
func Open(path string) (*Client, error) {
	db, err := sqlitedb.Open(path, false)
	if err != nil {
		return nil, err
	}
	return New(db)
}

// New returns a Client over db and creates its table if needed.
func New(db *sql.DB) (*Client, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("error creating sqlite cache schema: %w", err)
	}
	return &Client{db: db, now: time.Now}, nil
}

func (c *Client) nowMillis() int64 { return c.now().UnixMilli() }

// live is the SQL condition for an entry that has not expired.
const live = `(expires_at IS NULL OR expires_at > ?)`

// Set stores val under key. A positive ttl sets an expiry. A zero ttl stores
// the key without one. go-redis's KeepTTL (-1) keeps the current expiry.
func (c *Client) Set(ctx context.Context, key string, val string, ttl time.Duration) error {
	now := c.nowMillis()
	var err error
	switch {
	case ttl > 0:
		ms := ttl.Milliseconds()
		if ms == 0 {
			ms = 1
		}
		_, err = c.db.ExecContext(ctx, `INSERT INTO cache_entries (key, value, expires_at)
			VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value,
			expires_at = excluded.expires_at`, key, val, now+ms)
	case ttl == -1: // redis.KeepTTL
		_, err = c.db.ExecContext(ctx, `INSERT INTO cache_entries (key, value, expires_at)
			VALUES (?, ?, NULL) ON CONFLICT (key) DO UPDATE SET value = excluded.value,
			expires_at = CASE WHEN cache_entries.expires_at IS NULL OR cache_entries.expires_at > ?
				THEN cache_entries.expires_at ELSE NULL END`, key, val, now)
	default:
		_, err = c.db.ExecContext(ctx, `INSERT INTO cache_entries (key, value, expires_at)
			VALUES (?, ?, NULL) ON CONFLICT (key) DO UPDATE SET value = excluded.value,
			expires_at = NULL`, key, val)
	}
	if err != nil {
		return err
	}
	// Purge expired keys now and then, so the table does not grow without bound.
	_, err = c.db.ExecContext(ctx,
		`DELETE FROM cache_entries WHERE expires_at IS NOT NULL AND expires_at <= ?`, now)
	return err
}

// Incr adds one to the integer at key, or subtracts one if subtract is set. A
// missing or expired key counts as 0. The expiry, if any, is kept.
func (c *Client) Incr(ctx context.Context, key string, subtract bool) (int, error) {
	delta := int64(1)
	if subtract {
		delta = -1
	}
	now := c.nowMillis()

	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer func() { _ = tx.Rollback() }()

	var cur string
	var expiresAt sql.NullInt64
	err = tx.QueryRowContext(ctx, `SELECT value, expires_at FROM cache_entries
		WHERE key = ? AND `+live, key, now).Scan(&cur, &expiresAt)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		cur, expiresAt = "0", sql.NullInt64{}
	case err != nil:
		return 0, err
	}
	n, err := strconv.ParseInt(cur, 10, 64)
	if err != nil || strconv.FormatInt(n, 10) != cur {
		return 0, errNotInteger
	}
	n += delta

	var exp any
	if expiresAt.Valid {
		exp = expiresAt.Int64
	}
	if _, err := tx.ExecContext(ctx, `INSERT INTO cache_entries (key, value, expires_at)
		VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value,
		expires_at = excluded.expires_at`, key, strconv.FormatInt(n, 10), exp); err != nil {
		return 0, err
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return int(n), nil
}

// Get returns the value at key, or "" with no error if the key is missing or
// expired. With deleteAfterGet it is GETDEL.
func (c *Client) Get(ctx context.Context, key string, deleteAfterGet bool) (string, error) {
	now := c.nowMillis()
	if deleteAfterGet {
		return c.getDel(ctx, key, now)
	}
	var val string
	err := c.db.QueryRowContext(ctx,
		`SELECT value FROM cache_entries WHERE key = ? AND `+live, key, now).Scan(&val)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	return val, err
}

// getDel is GETDEL: read the live value and delete the key in one transaction.
func (c *Client) getDel(ctx context.Context, key string, now int64) (string, error) {
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer func() { _ = tx.Rollback() }()
	var val string
	err = tx.QueryRowContext(ctx,
		`SELECT value FROM cache_entries WHERE key = ? AND `+live, key, now).Scan(&val)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return "", err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM cache_entries WHERE key = ?`, key); err != nil {
		return "", err
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	return val, nil
}

// Del deletes keys. Redis rejects DEL with no keys, and so does this.
func (c *Client) Del(ctx context.Context, keys ...string) error {
	if len(keys) == 0 {
		return errors.New("ERR wrong number of arguments for 'del' command")
	}
	tx, err := c.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer func() { _ = tx.Rollback() }()
	for _, k := range keys {
		if _, err := tx.ExecContext(ctx, `DELETE FROM cache_entries WHERE key = ?`, k); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// FlushAll deletes every cache entry. It does not touch the datastore table
// that may share the same database file.
func (c *Client) FlushAll(ctx context.Context) error {
	_, err := c.db.ExecContext(ctx, `DELETE FROM cache_entries`)
	return err
}
