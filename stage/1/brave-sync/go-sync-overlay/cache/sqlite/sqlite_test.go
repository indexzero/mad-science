package sqlite

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/stretchr/testify/require"
)

func newTestClient(t *testing.T) (*Client, *time.Time) {
	t.Helper()
	c, err := Open(filepath.Join(t.TempDir(), "cache.db"))
	require.NoError(t, err)
	t.Cleanup(func() { _ = c.db.Close() })
	now := time.UnixMilli(1_700_000_000_000)
	c.now = func() time.Time { return now }
	return c, &now
}

func TestSetGetWithTTL(t *testing.T) {
	ctx := context.Background()
	c, now := newTestClient(t)

	require.NoError(t, c.Set(ctx, "k", "v", 10*time.Second))
	v, err := c.Get(ctx, "k", false)
	require.NoError(t, err)
	require.Equal(t, "v", v)

	*now = now.Add(10 * time.Second)
	v, err = c.Get(ctx, "k", false)
	require.NoError(t, err)
	require.Empty(t, v, "a key reads as missing once its TTL has passed")

	require.NoError(t, c.Set(ctx, "forever", "x", 0))
	*now = now.Add(365 * 24 * time.Hour)
	v, err = c.Get(ctx, "forever", false)
	require.NoError(t, err)
	require.Equal(t, "x", v, "a zero TTL means no expiry")
}

func TestGetDel(t *testing.T) {
	ctx := context.Background()
	c, _ := newTestClient(t)

	v, err := c.Get(ctx, "missing", true)
	require.NoError(t, err)
	require.Empty(t, v)

	require.NoError(t, c.Set(ctx, "k", "v", time.Minute))
	v, err = c.Get(ctx, "k", true)
	require.NoError(t, err)
	require.Equal(t, "v", v)
	v, err = c.Get(ctx, "k", false)
	require.NoError(t, err)
	require.Empty(t, v, "GETDEL removes the key")
}

func TestIncrDecr(t *testing.T) {
	ctx := context.Background()
	c, now := newTestClient(t)

	n, err := c.Incr(ctx, "n", false)
	require.NoError(t, err)
	require.Equal(t, 1, n, "INCR on a missing key starts at 0")
	n, err = c.Incr(ctx, "n", false)
	require.NoError(t, err)
	require.Equal(t, 2, n)
	n, err = c.Incr(ctx, "n", true)
	require.NoError(t, err)
	require.Equal(t, 1, n)

	n, err = c.Incr(ctx, "d", true)
	require.NoError(t, err)
	require.Equal(t, -1, n, "DECR on a missing key starts at 0")

	// INCR keeps the existing TTL.
	require.NoError(t, c.Set(ctx, "t", "5", 10*time.Second))
	n, err = c.Incr(ctx, "t", false)
	require.NoError(t, err)
	require.Equal(t, 6, n)
	*now = now.Add(10 * time.Second)
	n, err = c.Incr(ctx, "t", false)
	require.NoError(t, err)
	require.Equal(t, 1, n, "an expired key counts as missing")

	require.NoError(t, c.Set(ctx, "s", "abc", 0))
	_, err = c.Incr(ctx, "s", false)
	require.Error(t, err, "INCR on a non-integer fails")
}

func TestDelAndFlushAll(t *testing.T) {
	ctx := context.Background()
	c, _ := newTestClient(t)

	require.Error(t, c.Del(ctx), "DEL with no keys fails, as in Redis")

	require.NoError(t, c.Set(ctx, "a", "1", 0))
	require.NoError(t, c.Set(ctx, "b", "2", 0))
	require.NoError(t, c.Set(ctx, "c", "3", 0))
	require.NoError(t, c.Del(ctx, "a", "b", "nope"))
	v, err := c.Get(ctx, "a", false)
	require.NoError(t, err)
	require.Empty(t, v)
	v, err = c.Get(ctx, "c", false)
	require.NoError(t, err)
	require.Equal(t, "3", v)

	require.NoError(t, c.FlushAll(ctx))
	v, err = c.Get(ctx, "c", false)
	require.NoError(t, err)
	require.Empty(t, v)
}
