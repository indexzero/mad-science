package sqlite

import (
	"context"
	"database/sql"
	"fmt"

	"github.com/brave/go-sync/datastore"
)

// These helpers back datastore/datastoretest when SYNC_BACKEND=sqlite. Each
// one mirrors the Dynamo table operation or Scan filter that its datastoretest
// counterpart uses.

// ResetTable mirrors deleting and re-creating the Dynamo table.
func (s *Datastore) ResetTable() error {
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS sync_items`); err != nil {
		return fmt.Errorf("error deleting table to reset table: %w", err)
	}
	if _, err := s.db.Exec(schema); err != nil {
		return fmt.Errorf("error creating table: %w", err)
	}
	return nil
}

// DeleteTable mirrors deleting the Dynamo table. The next ResetTable creates
// it again.
func (s *Datastore) DeleteTable() error {
	if _, err := s.db.Exec(`DROP TABLE IF EXISTS sync_items`); err != nil {
		return fmt.Errorf("error deleting table: %w", err)
	}
	return nil
}

// ScanSyncEntities mirrors a Scan with attribute_exists(Version): sync items
// and item-count items. An item-count item reads as a SyncEntity with only
// ClientID, ID and Version set, as attributevalue would unmarshal it.
func (s *Datastore) ScanSyncEntities() ([]datastore.SyncEntity, error) {
	rows, err := s.db.QueryContext(context.Background(), `SELECT `+entityColumns+`
		FROM sync_items WHERE kind IN (?, ?) ORDER BY client_id, id`, kindEntity, kindCount)
	if err != nil {
		return nil, fmt.Errorf("error doing scan for sync entities: %w", err)
	}
	defer rows.Close()
	var items []datastore.SyncEntity
	for rows.Next() {
		e, err := scanEntity(rows)
		if err != nil {
			return nil, fmt.Errorf("error unmarshalling sync entities: %w", err)
		}
		items = append(items, e)
	}
	return items, rows.Err()
}

// ScanTagItems mirrors a Scan with attribute_not_exists(ExpireAt) and
// attribute_not_exists(Version): tag items and disabled-chain markers.
func (s *Datastore) ScanTagItems() ([]datastore.ServerClientUniqueTagItem, error) {
	rows, err := s.db.QueryContext(context.Background(), `SELECT client_id, id, mtime, ctime
		FROM sync_items WHERE kind IN (?, ?) ORDER BY client_id, id`, kindTag, kindDisabled)
	if err != nil {
		return nil, fmt.Errorf("error doing scan for tag items: %w", err)
	}
	defer rows.Close()
	var items []datastore.ServerClientUniqueTagItem
	for rows.Next() {
		var item datastore.ServerClientUniqueTagItem
		var mtime, ctime sql.NullInt64
		if err := rows.Scan(&item.ClientID, &item.ID, &mtime, &ctime); err != nil {
			return nil, fmt.Errorf("error unmarshalling tag items: %w", err)
		}
		item.Mtime = int64Ptr(mtime)
		item.Ctime = int64Ptr(ctime)
		items = append(items, item)
	}
	return items, rows.Err()
}

// ScanClientItemCounts mirrors a Scan with attribute_exists(ItemCount).
func (s *Datastore) ScanClientItemCounts() ([]datastore.ClientItemCounts, error) {
	rows, err := s.db.QueryContext(context.Background(), `SELECT client_id, id, item_count,
		history_item_count_period1, history_item_count_period2,
		history_item_count_period3, history_item_count_period4,
		last_period_change_time, version
		FROM sync_items WHERE kind = ? ORDER BY client_id, id`, kindCount)
	if err != nil {
		return nil, fmt.Errorf("error doing scan for item counts: %w", err)
	}
	defer rows.Close()
	var items []datastore.ClientItemCounts
	for rows.Next() {
		var c datastore.ClientItemCounts
		if err := rows.Scan(&c.ClientID, &c.ID, &c.ItemCount,
			&c.HistoryItemCountPeriod1, &c.HistoryItemCountPeriod2,
			&c.HistoryItemCountPeriod3, &c.HistoryItemCountPeriod4,
			&c.LastPeriodChangeTime, &c.Version); err != nil {
			return nil, fmt.Errorf("error unmarshalling item counts: %w", err)
		}
		items = append(items, c)
	}
	return items, rows.Err()
}
