// Command sqlite-inspect prints a summary of the dev server's SQLite store:
// item counts per data type, other row kinds, live cache keys, and the newest
// sync items. It opens the database read-only and never prints Specifics.
//
//	go run ./cmd/sqlite-inspect -db ./go-sync-dev.db -n 20
package main

import (
	"database/sql"
	"flag"
	"fmt"
	"os"
	"text/tabwriter"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/brave/go-sync/internal/sqlitedb"
	"github.com/brave/go-sync/schema/protobuf/sync_pb"
)

func typeName(id sql.NullInt64) string {
	if !id.Valid {
		return "-"
	}
	f := (&sync_pb.EntitySpecifics{}).ProtoReflect().Descriptor().Fields().
		ByNumber(protoreflect.FieldNumber(id.Int64))
	if f == nil {
		return "?"
	}
	return string(f.Name())
}

func fmtMillis(v sql.NullInt64) string {
	if !v.Valid {
		return "-"
	}
	return time.UnixMilli(v.Int64).UTC().Format("2006-01-02T15:04:05.000Z")
}

func fmtBool(v sql.NullInt64) string {
	if !v.Valid {
		return "-"
	}
	if v.Int64 != 0 {
		return "y"
	}
	return "n"
}

func fmtStr(v sql.NullString, max int) string {
	if !v.Valid {
		return "-"
	}
	s := v.String
	if len(s) > max {
		s = s[:max-1] + "~"
	}
	return s
}

func main() {
	path := flag.String("db", envOr("SQLITE_PATH", sqlitedb.DefaultPath), "SQLite database file")
	n := flag.Int("n", 20, "how many of the newest sync items to list")
	flag.Parse()

	if _, err := os.Stat(*path); err != nil {
		fmt.Fprintf(os.Stderr, "sqlite-inspect: %v\n", err)
		os.Exit(1)
	}
	db, err := sqlitedb.Open(*path, true)
	if err != nil {
		fmt.Fprintf(os.Stderr, "sqlite-inspect: %v\n", err)
		os.Exit(1)
	}
	defer db.Close()
	if err := run(db, *path, *n); err != nil {
		fmt.Fprintf(os.Stderr, "sqlite-inspect: %v\n", err)
		os.Exit(1)
	}
}

func envOr(k, def string) string {
	if v := os.Getenv(k); v != "" {
		return v
	}
	return def
}

func hasTable(db *sql.DB, name string) (bool, error) {
	var c int
	err := db.QueryRow(`SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?`, name).Scan(&c)
	return c > 0, err
}

func run(db *sql.DB, path string, n int) error {
	fmt.Printf("database: %s (read-only)\n\n", path)
	w := tabwriter.NewWriter(os.Stdout, 0, 0, 2, ' ', 0)

	ok, err := hasTable(db, "sync_items")
	if err != nil {
		return err
	}
	if !ok {
		fmt.Println("no sync_items table yet")
	} else {
		if err := printTypeCounts(db, w); err != nil {
			return err
		}
		if err := printKindCounts(db, w); err != nil {
			return err
		}
		if err := printNewest(db, w, n); err != nil {
			return err
		}
	}

	ok, err = hasTable(db, "cache_entries")
	if err != nil {
		return err
	}
	if ok {
		var live int
		err := db.QueryRow(`SELECT COUNT(*) FROM cache_entries WHERE expires_at IS NULL OR expires_at > ?`,
			time.Now().UnixMilli()).Scan(&live)
		if err != nil {
			return err
		}
		fmt.Printf("cache: %d live keys\n", live)
	}
	return nil
}

func printTypeCounts(db *sql.DB, w *tabwriter.Writer) error {
	rows, err := db.Query(`SELECT data_type, COUNT(*),
		SUM(CASE WHEN deleted = 1 THEN 1 ELSE 0 END),
		SUM(CASE WHEN folder = 1 THEN 1 ELSE 0 END),
		MAX(mtime)
		FROM sync_items WHERE kind = 'entity' GROUP BY data_type ORDER BY data_type`)
	if err != nil {
		return err
	}
	defer rows.Close()
	fmt.Fprintln(w, "TYPE\tNAME\tITEMS\tDELETED\tFOLDERS\tNEWEST MTIME (UTC)")
	total := 0
	for rows.Next() {
		var dt, mtime sql.NullInt64
		var count, deleted, folders int
		if err := rows.Scan(&dt, &count, &deleted, &folders, &mtime); err != nil {
			return err
		}
		total += count
		id := "-"
		if dt.Valid {
			id = fmt.Sprint(dt.Int64)
		}
		fmt.Fprintf(w, "%s\t%s\t%d\t%d\t%d\t%s\n", id, typeName(dt), count, deleted, folders, fmtMillis(mtime))
	}
	if err := rows.Err(); err != nil {
		return err
	}
	fmt.Fprintf(w, "\tall types\t%d\t\t\t\n", total)
	if err := w.Flush(); err != nil {
		return err
	}
	fmt.Println()
	return nil
}

func printKindCounts(db *sql.DB, w *tabwriter.Writer) error {
	rows, err := db.Query(`SELECT kind, COUNT(*), COUNT(DISTINCT client_id)
		FROM sync_items GROUP BY kind ORDER BY kind`)
	if err != nil {
		return err
	}
	defer rows.Close()
	fmt.Fprintln(w, "ROW KIND\tROWS\tCHAINS")
	for rows.Next() {
		var kind string
		var count, chains int
		if err := rows.Scan(&kind, &count, &chains); err != nil {
			return err
		}
		fmt.Fprintf(w, "%s\t%d\t%d\n", kind, count, chains)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := w.Flush(); err != nil {
		return err
	}
	fmt.Println()
	return nil
}

func printNewest(db *sql.DB, w *tabwriter.Writer, n int) error {
	rows, err := db.Query(`SELECT mtime, client_id, data_type, id, version, deleted, folder,
		COALESCE(non_unique_name, name), length(specifics)
		FROM sync_items WHERE kind = 'entity' ORDER BY mtime DESC, id LIMIT ?`, n)
	if err != nil {
		return err
	}
	defer rows.Close()
	fmt.Printf("newest %d sync items:\n", n)
	fmt.Fprintln(w, "MTIME (UTC)\tCHAIN\tTYPE\tID\tVER\tDEL\tDIR\tNAME\tSPECIFICS BYTES")
	for rows.Next() {
		var mtime, dt, version, deleted, folder, specLen sql.NullInt64
		var client, id string
		var name sql.NullString
		if err := rows.Scan(&mtime, &client, &dt, &id, &version, &deleted, &folder, &name, &specLen); err != nil {
			return err
		}
		ver := "-"
		if version.Valid {
			ver = fmt.Sprint(version.Int64)
		}
		size := "-"
		if specLen.Valid {
			size = fmt.Sprint(specLen.Int64)
		}
		fmt.Fprintf(w, "%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\t%s\n", fmtMillis(mtime),
			fmtStr(sql.NullString{String: client, Valid: true}, 12), typeName(dt),
			fmtStr(sql.NullString{String: id, Valid: true}, 36), ver,
			fmtBool(deleted), fmtBool(folder), fmtStr(name, 32), size)
	}
	if err := rows.Err(); err != nil {
		return err
	}
	if err := w.Flush(); err != nil {
		return err
	}
	fmt.Println()
	return nil
}
