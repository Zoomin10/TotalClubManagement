#!/usr/bin/env bash

set -e

echo "Checking working tree..."
if [ -n "$(git status --porcelain)" ]; then
  echo "You have uncommitted changes. Commit or stash them first."
  git status --short
  exit 1
fi

echo "Updating development..."
git checkout development
git pull origin development

echo "Updating production..."
git checkout main
git pull origin main

echo "Merging development into production..."
git merge development

echo "Pushing production..."
git push origin main

echo "Production release pushed."