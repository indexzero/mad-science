#!/bin/sh
# dev.sh: run the vendored go-sync dev server with its own docker compose file.
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
set -eu
here=$(cd "$(dirname "$0")/.." && pwd)
src="$here/vendor/go-sync"
[ -f "$src/docker-compose.yml" ] || { echo "dev.sh: run hack/vendor.sh first" >&2; exit 1; }
compose() { docker compose -p brave-sync-dev -f "$src/docker-compose.yml" "$@"; }
TABLE="${TABLE_NAME:-client-entity-dev}"

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
  *) sed -n '2,13p' "$0"; exit 2 ;;
esac
