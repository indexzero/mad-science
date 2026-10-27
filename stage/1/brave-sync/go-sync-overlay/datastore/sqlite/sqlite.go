// Package sqlite is a datastore.Datastore over SQLite, for the go-sync dev
// server only. It never holds real sync data.
//
// It is a port of the DynamoDB implementation in datastore/sync_entity.go and
// datastore/item_count.go. Dynamo keeps sync items, unique tag items, the
// disabled-chain marker and the item-count item in one table keyed by
// (ClientID, ID). This port does the same, in one SQLite table, so every
// operation sees the same rows Dynamo would. The kind column records which
// attributes a row carries, because Dynamo filters on attribute existence.
package sqlite

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strconv"
	"time"

	"github.com/brave/go-sync/datastore"
	"github.com/brave/go-sync/internal/sqlitedb"
)

// Row kinds. They mirror the item shapes Dynamo writes to its table.
const (
	kindEntity   = "entity"   // datastore.SyncEntity
	kindTag      = "tag"      // datastore.ServerClientUniqueTagItem
	kindDisabled = "disabled" // datastore.DisabledMarkerItem
	kindCount    = "count"    // datastore.ClientItemCounts
)

// Constants copied from datastore/sync_entity.go and item_count.go, where they
// are unexported.
const (
	clientTagItemPrefix = "Client#"
	serverTagItemPrefix = "Server#"
	disabledChainID     = "disabled_chain"
	reasonDeleted       = "deleted"
	periodDurationSecs  = int64(datastore.HistoryExpirationIntervalSecs / 4)
	// maxTransactWriteItems is DynamoDB's TransactWriteItems limit.
	maxTransactWriteItems = 100
)

// errConditionalCheckFailed stands in for Dynamo's ConditionalCheckFailed.
var errConditionalCheckFailed = errors.New("conditional check failed")

const schema = `
CREATE TABLE IF NOT EXISTS sync_items (
	client_id                    TEXT    NOT NULL,
	id                           TEXT    NOT NULL,
	kind                         TEXT    NOT NULL,
	parent_id                    TEXT,
	version                      INTEGER,
	mtime                        INTEGER,
	ctime                        INTEGER,
	name                         TEXT,
	non_unique_name              TEXT,
	server_defined_unique_tag    TEXT,
	deleted                      INTEGER,
	originator_cache_guid        TEXT,
	originator_client_item_id    TEXT,
	specifics                    BLOB,
	data_type                    INTEGER,
	folder                       INTEGER,
	client_defined_unique_tag    TEXT,
	unique_position              BLOB,
	data_type_mtime              TEXT,
	expiration_time              INTEGER,
	reason                       TEXT,
	item_count                   INTEGER,
	history_item_count_period1   INTEGER,
	history_item_count_period2   INTEGER,
	history_item_count_period3   INTEGER,
	history_item_count_period4   INTEGER,
	last_period_change_time      INTEGER,
	PRIMARY KEY (client_id, id)
);
-- The ClientIDDataTypeMtimeIndex GSI. Sparse, like the GSI: only rows with a
-- DataTypeMtime string are in it.
CREATE INDEX IF NOT EXISTS sync_items_client_data_type_mtime
	ON sync_items (client_id, data_type_mtime, id)
	WHERE data_type_mtime IS NOT NULL;
`

// Datastore is a datastore.Datastore over SQLite.
type Datastore struct {
	db *sql.DB
}

var _ datastore.Datastore = (*Datastore)(nil)

// Open opens the SQLite file at path and returns a Datastore over it.
func Open(path string) (*Datastore, error) {
	db, err := sqlitedb.Open(path, false)
	if err != nil {
		return nil, err
	}
	return New(db)
}

// New returns a Datastore over db and creates its table if needed.
func New(db *sql.DB) (*Datastore, error) {
	if _, err := db.Exec(schema); err != nil {
		return nil, fmt.Errorf("error creating sqlite datastore schema: %w", err)
	}
	return &Datastore{db: db}, nil
}

// DB returns the underlying handle, so the cache can share it.
func (s *Datastore) DB() *sql.DB { return s.db }

// Close closes the underlying handle.
func (s *Datastore) Close() error { return s.db.Close() }

// ---------------------------------------------------------------------------
// Value helpers. Dynamo stores a nil pointer or nil slice as a NULL attribute
// and reads it back as nil. A non-nil empty []byte is stored as an empty
// binary and reads back as a non-nil empty slice. These helpers keep that.

func nullStr(p *string) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullInt64(p *int64) any {
	if p == nil {
		return nil
	}
	return *p
}

func nullInt(p *int) any {
	if p == nil {
		return nil
	}
	return int64(*p)
}

func nullBool(p *bool) any {
	if p == nil {
		return nil
	}
	if *p {
		return int64(1)
	}
	return int64(0)
}

func nullBytes(b []byte) any {
	if b == nil {
		return nil
	}
	if len(b) == 0 {
		return []byte{}
	}
	return b
}

func strPtr(v sql.NullString) *string {
	if !v.Valid {
		return nil
	}
	s := v.String
	return &s
}

func int64Ptr(v sql.NullInt64) *int64 {
	if !v.Valid {
		return nil
	}
	i := v.Int64
	return &i
}

func intPtr(v sql.NullInt64) *int {
	if !v.Valid {
		return nil
	}
	i := int(v.Int64)
	return &i
}

func boolPtr(v sql.NullInt64) *bool {
	if !v.Valid {
		return nil
	}
	b := v.Int64 != 0
	return &b
}

// bytesOut normalizes a scanned blob. NULL is nil. An empty blob is []byte{}.
type nullBlob struct {
	b     []byte
	valid bool
}

func (n *nullBlob) Scan(src any) error {
	switch v := src.(type) {
	case nil:
		n.b, n.valid = nil, false
	case []byte:
		n.b, n.valid = append([]byte{}, v...), true
	case string:
		n.b, n.valid = []byte(v), true
	default:
		return fmt.Errorf("unexpected blob type %T", src)
	}
	return nil
}

func (n nullBlob) bytes() []byte {
	if !n.valid {
		return nil
	}
	return n.b
}

const entityColumns = `client_id, id, parent_id, version, mtime, ctime, name,
	non_unique_name, server_defined_unique_tag, deleted, originator_cache_guid,
	originator_client_item_id, specifics, data_type, folder,
	client_defined_unique_tag, unique_position, data_type_mtime, expiration_time`

type scanner interface {
	Scan(dest ...any) error
}

func scanEntity(row scanner) (datastore.SyncEntity, error) {
	var (
		e                                                  datastore.SyncEntity
		parentID, name, nonUniqueName, serverTag, origGUID sql.NullString
		origItemID, clientTag, dataTypeMtime               sql.NullString
		version, mtime, ctime, deleted, dataType, folder   sql.NullInt64
		expirationTime                                     sql.NullInt64
		specifics, uniquePosition                          nullBlob
	)
	err := row.Scan(&e.ClientID, &e.ID, &parentID, &version, &mtime, &ctime, &name,
		&nonUniqueName, &serverTag, &deleted, &origGUID, &origItemID, &specifics,
		&dataType, &folder, &clientTag, &uniquePosition, &dataTypeMtime, &expirationTime)
	if err != nil {
		return e, err
	}
	e.ParentID = strPtr(parentID)
	e.Version = int64Ptr(version)
	e.Mtime = int64Ptr(mtime)
	e.Ctime = int64Ptr(ctime)
	e.Name = strPtr(name)
	e.NonUniqueName = strPtr(nonUniqueName)
	e.ServerDefinedUniqueTag = strPtr(serverTag)
	e.Deleted = boolPtr(deleted)
	e.OriginatorCacheGUID = strPtr(origGUID)
	e.OriginatorClientItemID = strPtr(origItemID)
	e.Specifics = specifics.bytes()
	e.DataType = intPtr(dataType)
	e.Folder = boolPtr(folder)
	e.ClientDefinedUniqueTag = strPtr(clientTag)
	e.UniquePosition = uniquePosition.bytes()
	e.DataTypeMtime = strPtr(dataTypeMtime)
	e.ExpirationTime = int64Ptr(expirationTime)
	return e, nil
}

type execer interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
}

// putEntityIfAbsent mirrors PutItem with attribute_not_exists(ClientID).
func putEntityIfAbsent(ctx context.Context, x execer, e *datastore.SyncEntity) error {
	res, err := x.ExecContext(ctx, `INSERT INTO sync_items (kind, `+entityColumns+`)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT (client_id, id) DO NOTHING`,
		kindEntity, e.ClientID, e.ID, nullStr(e.ParentID), nullInt64(e.Version),
		nullInt64(e.Mtime), nullInt64(e.Ctime), nullStr(e.Name), nullStr(e.NonUniqueName),
		nullStr(e.ServerDefinedUniqueTag), nullBool(e.Deleted), nullStr(e.OriginatorCacheGUID),
		nullStr(e.OriginatorClientItemID), nullBytes(e.Specifics), nullInt(e.DataType),
		nullBool(e.Folder), nullStr(e.ClientDefinedUniqueTag), nullBytes(e.UniquePosition),
		nullStr(e.DataTypeMtime), nullInt64(e.ExpirationTime))
	return conditionalResult(res, err)
}

// putTagIfAbsent mirrors PutItem of a ServerClientUniqueTagItem with
// attribute_not_exists(ClientID).
func putTagIfAbsent(ctx context.Context, x execer, item *datastore.ServerClientUniqueTagItem) error {
	res, err := x.ExecContext(ctx, `INSERT INTO sync_items (client_id, id, kind, mtime, ctime)
		VALUES (?, ?, ?, ?, ?) ON CONFLICT (client_id, id) DO NOTHING`,
		item.ClientID, item.ID, kindTag, nullInt64(item.Mtime), nullInt64(item.Ctime))
	return conditionalResult(res, err)
}

func conditionalResult(res sql.Result, err error) error {
	if err != nil {
		return err
	}
	n, err := res.RowsAffected()
	if err != nil {
		return err
	}
	if n == 0 {
		return errConditionalCheckFailed
	}
	return nil
}

func exists(ctx context.Context, q interface {
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}, clientID, id string) (bool, error) {
	var one int
	err := q.QueryRowContext(ctx,
		`SELECT 1 FROM sync_items WHERE client_id = ? AND id = ?`, clientID, id).Scan(&one)
	if errors.Is(err, sql.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, err
	}
	return true, nil
}

// pace returns once the wall-clock millisecond is past the one in which a
// write started. On Dynamo every write is a network round trip of at least a
// millisecond, so mtimes that CreateDBSyncEntity assigns from time.Now() to
// writes made one after another are strictly increasing. go-sync relies on
// that: GetUpdatesForType returns items with an mtime above the client's
// token, so a later write with the same mtime as the token would never be
// returned. A SQLite write takes microseconds. Pacing keeps the property.
func pace(start time.Time) {
	startMs := start.UnixMilli()
	for {
		now := time.Now()
		if now.UnixMilli() > startMs {
			return
		}
		time.Sleep(time.UnixMilli(startMs + 1).Sub(now))
	}
}

// withTx runs fn in a transaction and commits only if fn returns nil.
func (s *Datastore) withTx(ctx context.Context, fn func(tx *sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}

// ---------------------------------------------------------------------------
// datastore.Datastore

// InsertSyncEntity ports Dynamo.InsertSyncEntity. With a client tag (and not
// the history type), the tag item and the sync item are written in one
// transaction, and a failed condition returns conflict = true.
func (s *Datastore) InsertSyncEntity(ctx context.Context, entity *datastore.SyncEntity) (bool, error) {
	defer pace(time.Now())
	if entity.ClientDefinedUniqueTag != nil && *entity.DataType != datastore.HistoryTypeID {
		item := datastore.NewServerClientUniqueTagItem(entity.ClientID, *entity.ClientDefinedUniqueTag, false)
		err := s.withTx(ctx, func(tx *sql.Tx) error {
			if err := putTagIfAbsent(ctx, tx, item); err != nil {
				return err
			}
			return putEntityIfAbsent(ctx, tx, entity)
		})
		if errors.Is(err, errConditionalCheckFailed) {
			return true, fmt.Errorf("error inserting sync item with client tag: %w", err)
		}
		if err != nil {
			return false, fmt.Errorf(
				"error writing tag item and sync item in a transaction to insert sync entity: %w", err)
		}
		return false, nil
	}

	if err := putEntityIfAbsent(ctx, s.db, entity); err != nil {
		return false, fmt.Errorf("error calling PutItem to insert sync item: %w", err)
	}
	return false, nil
}

// InsertSyncEntitiesWithServerTags ports Dynamo.InsertSyncEntitiesWithServerTags.
// All tag items and sync items are written in one transaction, or none are.
func (s *Datastore) InsertSyncEntitiesWithServerTags(ctx context.Context, entities []*datastore.SyncEntity) error {
	defer pace(time.Now())
	// TransactWriteItems takes between 1 and 100 actions. Keep that contract.
	if n := len(entities) * 2; n == 0 || n > maxTransactWriteItems {
		return fmt.Errorf("error writing sync entities with server tags in a transaction: "+
			"%d actions is outside TransactWriteItems' 1 to %d", n, maxTransactWriteItems)
	}
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		for _, entity := range entities {
			item := datastore.NewServerClientUniqueTagItem(entity.ClientID, *entity.ServerDefinedUniqueTag, true)
			if err := putTagIfAbsent(ctx, tx, item); err != nil {
				return err
			}
			if err := putEntityIfAbsent(ctx, tx, entity); err != nil {
				return err
			}
		}
		return nil
	})
	if err != nil {
		return fmt.Errorf("error writing sync entities with server tags in a transaction: %w", err)
	}
	return nil
}

// UpdateSyncEntity ports Dynamo.UpdateSyncEntity: the item must exist, and
// unless the type is history its Version must equal oldVersion.
func (s *Datastore) UpdateSyncEntity(
	ctx context.Context,
	entity *datastore.SyncEntity,
	oldVersion int64,
) (bool, bool, error) {
	defer pace(time.Now())
	softDeleteWithClientTag := entity.Deleted != nil && entity.ClientDefinedUniqueTag != nil &&
		*entity.Deleted && *entity.DataType != datastore.HistoryTypeID
	checkVersion := *entity.DataType != datastore.HistoryTypeID

	var conflict, deleted bool
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		var oldVer, oldDeleted sql.NullInt64
		err := tx.QueryRowContext(ctx,
			`SELECT version, deleted FROM sync_items WHERE client_id = ? AND id = ?`,
			entity.ClientID, entity.ID).Scan(&oldVer, &oldDeleted)
		if errors.Is(err, sql.ErrNoRows) {
			conflict = true
			return nil
		}
		if err != nil {
			return err
		}
		if checkVersion && (!oldVer.Valid || oldVer.Int64 != oldVersion) {
			conflict = true
			return nil
		}

		set := `version = ?, mtime = ?, specifics = ?, data_type_mtime = ?`
		args := []any{nullInt64(entity.Version), nullInt64(entity.Mtime),
			nullBytes(entity.Specifics), nullStr(entity.DataTypeMtime)}
		if entity.UniquePosition != nil {
			set += `, unique_position = ?`
			args = append(args, nullBytes(entity.UniquePosition))
		}
		if entity.ParentID != nil {
			set += `, parent_id = ?`
			args = append(args, *entity.ParentID)
		}
		if entity.Name != nil {
			set += `, name = ?`
			args = append(args, *entity.Name)
		}
		if entity.NonUniqueName != nil {
			set += `, non_unique_name = ?`
			args = append(args, *entity.NonUniqueName)
		}
		if entity.Deleted != nil {
			set += `, deleted = ?`
			args = append(args, nullBool(entity.Deleted))
		}
		if entity.Folder != nil {
			set += `, folder = ?`
			args = append(args, nullBool(entity.Folder))
		}
		args = append(args, entity.ClientID, entity.ID)
		if _, err := tx.ExecContext(ctx,
			`UPDATE sync_items SET `+set+` WHERE client_id = ? AND id = ?`, args...); err != nil {
			return err
		}

		if softDeleteWithClientTag {
			// Delete the tag item in the same transaction. Dynamo's Delete has
			// no condition, so a missing tag item is not an error.
			if _, err := tx.ExecContext(ctx,
				`DELETE FROM sync_items WHERE client_id = ? AND id = ?`,
				entity.ClientID, clientTagItemPrefix+*entity.ClientDefinedUniqueTag); err != nil {
				return err
			}
			deleted = true
			return nil
		}

		switch {
		case entity.Deleted == nil: // No updates on Deleted this time.
			deleted = false
		case !oldDeleted.Valid: // Consider it as Deleted = false.
			deleted = *entity.Deleted
		default:
			deleted = oldDeleted.Int64 == 0 && *entity.Deleted
		}
		return nil
	})
	if err != nil {
		if softDeleteWithClientTag {
			return false, false, fmt.Errorf("error deleting sync item and tag item in a transaction: %w", err)
		}
		return false, false, fmt.Errorf("error calling UpdateItem to update sync entity: %w", err)
	}
	if conflict {
		return true, false, nil
	}
	return false, deleted, nil
}

// GetUpdatesForType ports Dynamo.GetUpdatesForType.
//
// Dynamo queries the (ClientID, DataTypeMtime) GSI with a string BETWEEN on
// "<type>#<token+1>" and "<type+1>#0", reads at most maxSize index entries,
// and only then applies the Folder filter. LastEvaluatedKey, and so
// hasChangesRemaining, is set whenever the read stopped at maxSize. Expired
// items are dropped after that, and the result is sorted by Mtime. SQLite's
// default BINARY collation compares TEXT bytewise, as Dynamo compares strings.
func (s *Datastore) GetUpdatesForType(
	ctx context.Context,
	dataType int,
	clientToken int64,
	fetchFolders bool,
	clientID string,
	maxSize int,
) (bool, []datastore.SyncEntity, error) {
	syncEntities := []datastore.SyncEntity{}
	if maxSize < 1 {
		// Dynamo rejects a Query Limit below 1.
		return false, syncEntities, fmt.Errorf("error doing query to get updates: limit %d is below 1", maxSize)
	}

	lower := strconv.Itoa(dataType) + "#" + strconv.FormatInt(clientToken+1, 10)
	upper := strconv.Itoa(dataType+1) + "#0"

	rows, err := s.db.QueryContext(ctx, `SELECT `+entityColumns+`
		FROM sync_items INDEXED BY sync_items_client_data_type_mtime
		WHERE client_id = ? AND data_type_mtime IS NOT NULL
		  AND data_type_mtime BETWEEN ? AND ?
		ORDER BY data_type_mtime, id
		LIMIT ?`, clientID, lower, upper, maxSize)
	if err != nil {
		return false, syncEntities, fmt.Errorf("error doing query to get updates: %w", err)
	}
	evaluated := 0
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			_ = rows.Close()
			return false, syncEntities, fmt.Errorf("error unmarshalling updated sync entities: %w", err)
		}
		evaluated++
		// FilterExpression Folder = :false. A missing or NULL Folder fails it.
		if !fetchFolders && (e.Folder == nil || *e.Folder) {
			continue
		}
		syncEntities = append(syncEntities, e)
	}
	if err := rows.Err(); err != nil {
		_ = rows.Close()
		return false, syncEntities, fmt.Errorf("error doing query to get updates: %w", err)
	}
	_ = rows.Close()

	hasChangesRemaining := evaluated == maxSize

	if len(syncEntities) == 0 { // No updates
		return hasChangesRemaining, syncEntities, nil
	}

	// filter out any expired items, i.e. history sync entities over 90 days old
	nowUnix := time.Now().Unix()
	var filteredSyncEntities []datastore.SyncEntity
	for _, syncEntity := range syncEntities {
		if syncEntity.ExpirationTime != nil && *syncEntity.ExpirationTime > 0 {
			if *syncEntity.ExpirationTime < nowUnix {
				continue
			}
		}
		filteredSyncEntities = append(filteredSyncEntities, syncEntity)
	}

	sort.Sort(datastore.SyncEntityByMtime(filteredSyncEntities))
	return hasChangesRemaining, filteredSyncEntities, nil
}

// HasServerDefinedUniqueTag ports Dynamo.HasServerDefinedUniqueTag.
func (s *Datastore) HasServerDefinedUniqueTag(ctx context.Context, clientID string, tag string) (bool, error) {
	ok, err := exists(ctx, s.db, clientID, serverTagItemPrefix+tag)
	if err != nil {
		return false, fmt.Errorf("error calling GetItem to check if server tag existed: %w", err)
	}
	return ok, nil
}

// HasItem ports Dynamo.HasItem.
func (s *Datastore) HasItem(ctx context.Context, clientID string, id string) (bool, error) {
	ok, err := exists(ctx, s.db, clientID, id)
	if err != nil {
		return false, fmt.Errorf("error calling GetItem to check if item existed: %w", err)
	}
	return ok, nil
}

// DisableSyncChain ports Dynamo.DisableSyncChain. PutItem has no condition, so
// it replaces any existing item at that key.
func (s *Datastore) DisableSyncChain(ctx context.Context, clientID string) error {
	now := time.Now().UnixMilli()
	_, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO sync_items
		(client_id, id, kind, reason, mtime, ctime) VALUES (?, ?, ?, ?, ?, ?)`,
		clientID, disabledChainID, kindDisabled, reasonDeleted, now, now)
	if err != nil {
		return fmt.Errorf("error calling PutItem to insert sync item: %w", err)
	}
	return nil
}

// IsSyncChainDisabled ports Dynamo.IsSyncChainDisabled.
func (s *Datastore) IsSyncChainDisabled(ctx context.Context, clientID string) (bool, error) {
	ok, err := exists(ctx, s.db, clientID, disabledChainID)
	if err != nil {
		return false, fmt.Errorf("error calling GetItem to check if sync chain disabled: %w", err)
	}
	return ok, nil
}

// ClearServerData ports Dynamo.ClearServerData. It returns every item of the
// chain, in sort key order, projected to ClientID, ID, Mtime, Version and
// DataType. It deletes all of them except the disabled-chain marker. Dynamo
// guards each delete with "Mtime unchanged since the read". Here the read and
// the deletes share one transaction, so nothing can change in between.
func (s *Datastore) ClearServerData(ctx context.Context, clientID string) ([]datastore.SyncEntity, error) {
	syncEntities := []datastore.SyncEntity{}
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		rows, err := tx.QueryContext(ctx, `SELECT client_id, id, mtime, version, data_type
			FROM sync_items WHERE client_id = ? ORDER BY id`, clientID)
		if err != nil {
			return fmt.Errorf("error querying sync entities to clear: %w", err)
		}
		for rows.Next() {
			var e datastore.SyncEntity
			var mtime, version, dataType sql.NullInt64
			if err := rows.Scan(&e.ClientID, &e.ID, &mtime, &version, &dataType); err != nil {
				_ = rows.Close()
				return fmt.Errorf("error unmarshalling sync entities to clear: %w", err)
			}
			e.Mtime = int64Ptr(mtime)
			e.Version = int64Ptr(version)
			e.DataType = intPtr(dataType)
			syncEntities = append(syncEntities, e)
		}
		if err := rows.Err(); err != nil {
			_ = rows.Close()
			return fmt.Errorf("error querying sync entities to clear: %w", err)
		}
		_ = rows.Close()

		if _, err := tx.ExecContext(ctx,
			`DELETE FROM sync_items WHERE client_id = ? AND id <> ?`, clientID, disabledChainID); err != nil {
			return fmt.Errorf("error deleting sync entities for client %s: %w", clientID, err)
		}
		return nil
	})
	if err != nil {
		return syncEntities, err
	}
	return syncEntities, nil
}

// ---------------------------------------------------------------------------
// Item counts, ported from datastore/item_count.go.

// GetClientItemCount ports Dynamo.GetClientItemCount.
func (s *Datastore) GetClientItemCount(ctx context.Context, clientID string) (*datastore.ClientItemCounts, error) {
	counts := &datastore.ClientItemCounts{}
	var itemCount, p1, p2, p3, p4, lastChange, version sql.NullInt64
	err := s.db.QueryRowContext(ctx, `SELECT client_id, id, item_count,
		history_item_count_period1, history_item_count_period2,
		history_item_count_period3, history_item_count_period4,
		last_period_change_time, version
		FROM sync_items WHERE client_id = ? AND id = ?`, clientID, clientID).Scan(
		&counts.ClientID, &counts.ID, &itemCount, &p1, &p2, &p3, &p4, &lastChange, &version)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("error getting an item-count item: %w", err)
	}
	counts.ItemCount = int(itemCount.Int64)
	counts.HistoryItemCountPeriod1 = int(p1.Int64)
	counts.HistoryItemCountPeriod2 = int(p2.Int64)
	counts.HistoryItemCountPeriod3 = int(p3.Int64)
	counts.HistoryItemCountPeriod4 = int(p4.Int64)
	counts.LastPeriodChangeTime = lastChange.Int64
	counts.Version = int(version.Int64)

	if len(counts.ClientID) == 0 {
		counts.ClientID = clientID
		counts.ID = clientID
	}

	if err := s.initRealCountsAndUpdateHistoryCounts(ctx, counts); err != nil {
		return nil, err
	}
	return counts, nil
}

func (s *Datastore) initRealCountsAndUpdateHistoryCounts(ctx context.Context, counts *datastore.ClientItemCounts) error {
	now := time.Now().Unix()
	if counts.Version < datastore.CurrentCountVersion {
		return s.migrateLegacyItemCounts(ctx, counts, now)
	}
	rotateHistoryCountPeriods(counts, now)
	return nil
}

func (s *Datastore) migrateLegacyItemCounts(ctx context.Context, counts *datastore.ClientItemCounts, now int64) error {
	if counts.ItemCount > 0 {
		if err := s.refreshItemCountsFromTable(ctx, counts); err != nil {
			return err
		}
	}
	counts.LastPeriodChangeTime = now
	counts.Version = datastore.CurrentCountVersion
	return nil
}

// refreshItemCountsFromTable ports the two filtered COUNT queries. Only sync
// items carry a DataType attribute. "Deleted = false" fails for a missing or
// NULL Deleted.
func (s *Datastore) refreshItemCountsFromTable(ctx context.Context, counts *datastore.ClientItemCounts) error {
	var historyCount, normalCount int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sync_items
		WHERE client_id = ? AND kind = ? AND data_type IN (?, ?) AND deleted = 0`,
		counts.ClientID, kindEntity, datastore.HistoryTypeID, datastore.HistoryDeleteDirectiveTypeID,
	).Scan(&historyCount)
	if err != nil {
		return fmt.Errorf("error querying history item count: %w", err)
	}
	counts.HistoryItemCountPeriod1 = 0
	counts.HistoryItemCountPeriod2 = 0
	counts.HistoryItemCountPeriod3 = 0
	counts.HistoryItemCountPeriod4 = historyCount

	// "DataType <> x" holds for a NULL DataType, since the types differ.
	err = s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM sync_items
		WHERE client_id = ? AND kind = ? AND (data_type IS NULL OR data_type NOT IN (?, ?))
		  AND deleted = 0`,
		counts.ClientID, kindEntity, datastore.HistoryTypeID, datastore.HistoryDeleteDirectiveTypeID,
	).Scan(&normalCount)
	if err != nil {
		return fmt.Errorf("error querying normal item count: %w", err)
	}
	counts.ItemCount = normalCount
	return nil
}

func rotateHistoryCountPeriods(counts *datastore.ClientItemCounts, now int64) {
	timeSinceLastChange := now - counts.LastPeriodChangeTime
	if timeSinceLastChange < periodDurationSecs {
		return
	}
	changeCount := int(timeSinceLastChange / periodDurationSecs)
	for range changeCount {
		counts.HistoryItemCountPeriod1 = counts.HistoryItemCountPeriod2
		counts.HistoryItemCountPeriod2 = counts.HistoryItemCountPeriod3
		counts.HistoryItemCountPeriod3 = counts.HistoryItemCountPeriod4
		counts.HistoryItemCountPeriod4 = 0
	}
	counts.LastPeriodChangeTime += periodDurationSecs * int64(changeCount)
}

// UpdateClientItemCount ports Dynamo.UpdateClientItemCount. PutItem replaces
// the whole item-count item.
func (s *Datastore) UpdateClientItemCount(
	ctx context.Context,
	counts *datastore.ClientItemCounts,
	newNormalItemCount int,
	newHistoryItemCount int,
) error {
	counts.HistoryItemCountPeriod4 += newHistoryItemCount
	counts.ItemCount += newNormalItemCount

	_, err := s.db.ExecContext(ctx, `INSERT OR REPLACE INTO sync_items
		(client_id, id, kind, item_count, history_item_count_period1,
		 history_item_count_period2, history_item_count_period3,
		 history_item_count_period4, last_period_change_time, version)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		counts.ClientID, counts.ID, kindCount, counts.ItemCount,
		counts.HistoryItemCountPeriod1, counts.HistoryItemCountPeriod2,
		counts.HistoryItemCountPeriod3, counts.HistoryItemCountPeriod4,
		counts.LastPeriodChangeTime, counts.Version)
	if err != nil {
		return fmt.Errorf("error updating item-count item in sqlite: %w", err)
	}
	return nil
}
