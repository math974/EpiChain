#!/usr/bin/env bash
set -euo pipefail

# Clean Docker resources for the EpiChain project and rebuild services.
# Removes only containers (and related resources) created from the chosen compose file.
# Usage:
#   ./scripts/clean_rebuild.sh [--prod] [--full] [--clean-only] [--help]
#
# Defaults:
#   compose: docker-compose.yml
#   env file: .env
#
# With --prod:
#   env file: .env.prod (same compose file)
#
# With --full:
#   `compose down -v` plus removal of remaining epichain_* volumes (postgres_data,
#   frontend_node_modules, indexer_node_modules, etc.)
#
# With --clean-only:
#   only delete containers/images/networks (and volumes if --full); do not rebuild or start
#
# Can be run from anywhere; the script resolves the repository root automatically.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

COMPOSE_FILE="docker-compose.yml"
PROJECT_PREFIX="epichain"
ENV_FILE=".env"
ENV_FILES=(".env" ".env.docker.example")
FULL_CLEAN=false
CLEAN_ONLY=false

show_help() {
  cat <<EOF
Usage: $0 [--prod] [--full] [--clean-only] [--help]

Options:
  --prod       Use .env.prod instead of .env (same ${COMPOSE_FILE})
  --full       Remove compose volumes (Postgres + node_modules volumes, etc.)
  --clean-only Only delete containers/images/networks; do not rebuild or start
  --help       Show this help

Default: ${COMPOSE_FILE} and .env.
Without --clean-only: rebuilds without cache then docker compose up --build (attached; use up -d for detached).

Copy .env.docker.example to .env (or .env.prod) and fill in secrets before running.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --prod)
      ENV_FILE=".env.prod"
      ENV_FILES=(".env.prod" ".env.docker.example")
      shift
      ;;
    --full)
      FULL_CLEAN=true
      shift
      ;;
    --clean-only)
      CLEAN_ONLY=true
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      show_help
      exit 1
      ;;
  esac
done

if [[ ! -f "${COMPOSE_FILE}" ]]; then
  echo "Error: ${COMPOSE_FILE} not found in ${REPO_ROOT}." >&2
  exit 1
fi

DOWN_ARGS=(--remove-orphans)
if [[ "${FULL_CLEAN}" == "true" ]]; then
  DOWN_ARGS+=(-v)
fi

echo ">> Stopping and removing containers from ${COMPOSE_FILE} (env: ${ENV_FILE})"
if [[ -f "${ENV_FILE}" ]]; then
  docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" down "${DOWN_ARGS[@]}" || true
else
  echo "   Warning: ${ENV_FILE} not found; running compose down without --env-file." >&2
  docker compose -f "${COMPOSE_FILE}" down "${DOWN_ARGS[@]}" || true
fi

echo ">> Removing any leftover containers matching name ${PROJECT_PREFIX}"
docker ps -a -q --filter "name=${PROJECT_PREFIX}" | xargs -r docker rm -f

echo ">> Removing project images (reference ${PROJECT_PREFIX}*)"
docker images -q --filter "reference=${PROJECT_PREFIX}*" | xargs -r docker rmi -f

if [[ "${FULL_CLEAN}" == "true" ]]; then
  echo ">> Removing project volumes (name contains ${PROJECT_PREFIX})"
  docker volume ls -q --filter "name=${PROJECT_PREFIX}" | xargs -r docker volume rm
else
  echo ">> Skipping extra volume removal (use --full to remove ${PROJECT_PREFIX}_* volumes)"
fi

echo ">> Removing project networks (name contains ${PROJECT_PREFIX})"
docker network ls -q --filter "name=${PROJECT_PREFIX}" | xargs -r docker network rm

if [[ "${CLEAN_ONLY}" == "true" ]]; then
  echo ">> Clean only (--clean-only): done. Not rebuilding or starting."
  exit 0
fi

echo ">> Checking env files"
for f in "${ENV_FILES[@]}"; do
  if [[ -f "${f}" ]]; then
    echo "   - found ${f}"
  else
    echo "   - ${f} missing (create it before running compose; see .env.docker.example)" >&2
  fi
done

if [[ ! -f "${ENV_FILE}" ]]; then
  echo "Error: ${ENV_FILE} is required for rebuild. Copy from .env.docker.example:" >&2
  echo "  cp .env.docker.example ${ENV_FILE}" >&2
  exit 1
fi

echo ">> Rebuilding without cache and starting up (variables in ${ENV_FILE} are applied, e.g. POSTGRES_* / DATABASE_URL)"
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" build --no-cache
docker compose --env-file "${ENV_FILE}" -f "${COMPOSE_FILE}" up --build
