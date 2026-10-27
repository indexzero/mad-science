#!/bin/sh
# dev.sh: run the vendored go-sync dev server, in docker or as one native binary.
#
#   hack/dev.sh up       build and start web (port 8295), dynamo-local (8000), redis (6379)
#   hack/dev.sh down     stop and remove the containers (volumes are kept)
#   hack/dev.sh ps       show the services
#   hack/dev.sh logs     follow the web service log
#   hack/dev.sh health   GET the server's health endpoint
#   hack/dev.sh tables   list DynamoDB tables in dynamo-local
#   hack/dev.sh dump     scan the sync table, one JSON item per line, to stdout
#   hack/dev.sh count    count items per data type in the sync table
#   hack/dev.sh redis    list redis keys
#   hack/dev.sh native   build and run the server natively on :8295, SQLite for store and cache
#   hack/dev.sh sqlite   read the native server's SQLite store (read-only): counts per type, newest rows
#
# native and sqlite use SQLITE_PATH, default vendor/go-sync-dev.db. Pass sqlite
# "-n 50" to list more rows. Dev only: never point this at real sync data.
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/vendor/go-sync"
[ -f "$src/docker-compose.yml" ] || { echo "dev.sh: run hack/vendor.sh first" >&2; exit 1; }
compose() { docker compose -p brave-sync-dev -f "$src/docker-compose.yml" "$@"; }
TABLE="${TABLE_NAME:-client-entity-dev}"
bindir="$here/vendor/bin"

# The SQLite file for native and sqlite, as an absolute path.
sqlite_path() {
  p="${SQLITE_PATH:-$here/vendor/go-sync-dev.db}"
  case "$p" in /*) ;; *) p="$PWD/$p" ;; esac
  echo "$p"
}

# Build a go-sync package from the vendored checkout into vendor/bin.
gobuild() {
  [ -f "$src/server/backend.go" ] || { echo "dev.sh: no SQLite backend in $src; run hack/vendor.sh" >&2; exit 1; }
  mkdir -p "$bindir"
  (cd "$src" && GOFLAGS="${GOFLAGS:--p=2}" go build -o "$bindir/$1" "$2")
}

# The aws CLI against dynamo-local. Uses a host aws if present, else the official image.
ddb() {
  if command -v aws >/dev/null 2>&1; then
    AWS_ACCESS_KEY_ID=GOSYNC AWS_SECRET_ACCESS_KEY=GOSYNC AWS_REGION=us-west-2 \
      aws --endpoint-url http://localhost:8000 dynamodb "$@"
  else
    docker run --rm --network host -e AWS_ACCESS_KEY_ID=GOSYNC -e AWS_SECRET_ACCESS_KEY=GOSYNC \
      -e AWS_REGION=us-west-2 public.ecr.aws/aws-cli/aws-cli:latest \
      --endpoint-url http://host.docker.internal:8000 dynamodb "$@"
  fi
}

case "${1:-}" in
  up)     (cd "$src" && compose up -d --build web) ;;
  down)   compose down ;;
  ps)     compose ps ;;
  logs)   compose logs -f web ;;
  health) curl -sS -i http://localhost:8295/health-check ;;
  tables) ddb list-tables ;;
  dump)   ddb scan --table-name "$TABLE" --output json | python3 -I -c 'import json,sys; [print(json.dumps(i)) for i in json.load(sys.stdin)["Items"]]' ;;
  count)  ddb scan --table-name "$TABLE" --output json | python3 -I -c '
import json,sys,collections
c=collections.Counter(i.get("DataType",{}).get("N","?") for i in json.load(sys.stdin)["Items"])
[print(k,v) for k,v in sorted(c.items())]' ;;
  redis)  compose exec redis redis-cli --scan ;;
  native)
    db=$(sqlite_path)
    gobuild go-sync .
    echo "dev.sh: go-sync on :8295, SQLite store and cache at $db"
    exec env SYNC_BACKEND=sqlite SQLITE_PATH="$db" ENV=local "$bindir/go-sync" ;;
  sqlite)
    shift
    db=$(sqlite_path)
    gobuild sqlite-inspect ./cmd/sqlite-inspect
    exec "$bindir/sqlite-inspect" -db "$db" "$@" ;;
  *) sed -n '2,17p' "$0"; exit 2 ;;
esac
