#!/usr/bin/env bash
set -e

# Load .env
export $(grep -v '^#' .env | xargs)

npx ng build
npx wrangler pages deploy dist/rocket-map/browser --project-name=rocketmap
