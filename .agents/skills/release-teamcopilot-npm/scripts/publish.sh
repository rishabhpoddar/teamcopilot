#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT_DIR"

MODE="dry-run"
PUBLISH_TAG=""
ACCESS_FLAG=""
OTP_CODE=""
SKIP_CHECKS=0

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
    --otp)
      OTP_CODE="$2"
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
NPM_USER="$(npm whoami)"
PACK_OUTPUT=""
PACK_FILENAME=""

cleanup() {
  if [[ -n "$PACK_FILENAME" && -f "$PACK_FILENAME" ]]; then
    rm -f "$PACK_FILENAME"
  fi
}

trap cleanup EXIT

echo "Preparing npm release for ${PACKAGE_NAME}@${PACKAGE_VERSION}"
if [[ "$PACKAGE_VERSION" != "$PACKAGE_LOCK_VERSION" ]]; then
  echo "Version mismatch: package.json=${PACKAGE_VERSION}, package-lock.json=${PACKAGE_LOCK_VERSION}" >&2
  exit 1
fi

if [[ "$NPM_USER" != "trythisapp" ]]; then
  echo "Expected npm user trythisapp, got ${NPM_USER}" >&2
  exit 1
fi

echo "Authenticated to npm as ${NPM_USER}"
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
if [[ -n "$OTP_CODE" ]]; then
  PUBLISH_ARGS+=("--otp" "$OTP_CODE")
fi

echo "Publishing ${PACKAGE_NAME}@${PACKAGE_VERSION} to npm"
npm publish "${PUBLISH_ARGS[@]}"
