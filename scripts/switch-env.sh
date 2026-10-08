#!/usr/bin/env bash

set -e

ENV=$1

if [ "$ENV" = "dev" ]; then
  git checkout development
  git pull origin development
  echo "Now on DEVELOPMENT branch"
elif [ "$ENV" = "prod" ]; then
  git checkout production
  git pull origin production
  echo "Now on PRODUCTION branch"
else
  echo "Usage: ./scripts/switch-env.sh dev|prod"
  exit 1
fi

echo ""
git status --short