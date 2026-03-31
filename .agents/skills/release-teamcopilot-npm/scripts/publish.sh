#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
cd "$ROOT_DIR"
ENV_FILE="$ROOT_DIR/.env"

MODE="dry-run"
PUBLISH_TAG=""
ACCESS_FLAG=""
SKIP_CHECKS=0
TOKEN_ENV_NAME=""
NPM_CONFIG_FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run)
      MODE="dry-run"
      shift
      ;;
    --publish)
      MODE="publish"
      shift
      ;;
    --tag)
      PUBLISH_TAG="$2"
      shift 2
      ;;
    --access)
      ACCESS_FLAG="$2"
      shift 2
      ;;
    --skip-checks)
      SKIP_CHECKS=1
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

PACKAGE_NAME="$(node -p "require('./package.json').name")"
PACKAGE_VERSION="$(node -p "require('./package.json').version")"
PACKAGE_LOCK_VERSION="$(node -p "require('./package-lock.json').version")"

if [[ -f "$ENV_FILE" ]]; then
  eval "$(
    node -e '
      const fs = require("fs");
      const dotenv = require("dotenv");
      const envPath = process.argv[1];
      const parsed = dotenv.parse(fs.readFileSync(envPath));
      for (const [key, value] of Object.entries(parsed)) {
        if (key === "NPM_TOKEN" || key === "NODE_AUTH_TOKEN") {
          process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
        }
      }
    ' "$ENV_FILE"
  )"
fi

NPM_TOKEN_VALUE="${NPM_TOKEN:-${NODE_AUTH_TOKEN:-}}"
PACK_OUTPUT=""
PACK_FILENAME=""

cleanup() {
  if [[ -n "$PACK_FILENAME" && -f "$PACK_FILENAME" ]]; then
    rm -f "$PACK_FILENAME"
  fi
  if [[ -n "$NPM_CONFIG_FILE" && -f "$NPM_CONFIG_FILE" ]]; then
    rm -f "$NPM_CONFIG_FILE"
  fi
}

trap cleanup EXIT

echo "Preparing npm release for ${PACKAGE_NAME}@${PACKAGE_VERSION}"
if [[ "$PACKAGE_VERSION" != "$PACKAGE_LOCK_VERSION" ]]; then
  echo "Version mismatch: package.json=${PACKAGE_VERSION}, package-lock.json=${PACKAGE_LOCK_VERSION}" >&2
  exit 1
fi

if [[ -z "$NPM_TOKEN_VALUE" ]]; then
  echo "Missing npm access token. Set NPM_TOKEN or NODE_AUTH_TOKEN in ${ENV_FILE} or the shell environment before running this script." >&2
  exit 1
fi

if [[ -n "${NPM_TOKEN:-}" ]]; then
  TOKEN_ENV_NAME="NPM_TOKEN"
else
  TOKEN_ENV_NAME="NODE_AUTH_TOKEN"
fi

NPM_CONFIG_FILE="$(mktemp)"
cat > "$NPM_CONFIG_FILE" <<EOF
//registry.npmjs.org/:_authToken=${NPM_TOKEN_VALUE}
registry=https://registry.npmjs.org/
always-auth=true
EOF
export NPM_CONFIG_USERCONFIG="$NPM_CONFIG_FILE"

NPM_USER="$(npm whoami)"
if [[ "$NPM_USER" != "trythisapp" ]]; then
  echo "Expected npm user trythisapp, got ${NPM_USER}" >&2
  exit 1
fi

echo "Authenticated to npm as ${NPM_USER} using ${TOKEN_ENV_NAME}"
if [[ "$SKIP_CHECKS" -eq 0 ]]; then
  npm run test
  npm run build
  PACK_OUTPUT="$(npm pack --json)"
  echo "$PACK_OUTPUT"
  PACK_FILENAME="$(printf '%s' "$PACK_OUTPUT" | node -e "const fs = require('fs'); const data = JSON.parse(fs.readFileSync(0, 'utf8')); if (!Array.isArray(data) || data.length === 0 || !data[0].filename) { process.exit(1); } process.stdout.write(data[0].filename);")"
else
  echo "Skipping test/build/pack checks. Use this only after a successful dry run for the same commit."
fi

if [[ "$MODE" != "publish" ]]; then
  echo "Dry run complete. Re-run with --publish to publish ${PACKAGE_NAME}@${PACKAGE_VERSION}."
  exit 0
fi

PUBLISH_ARGS=()
if [[ -n "$PUBLISH_TAG" ]]; then
  PUBLISH_ARGS+=("--tag" "$PUBLISH_TAG")
fi
if [[ -n "$ACCESS_FLAG" ]]; then
  PUBLISH_ARGS+=("--access" "$ACCESS_FLAG")
fi

echo "Publishing ${PACKAGE_NAME}@${PACKAGE_VERSION} to npm"
npm publish "${PUBLISH_ARGS[@]}"
