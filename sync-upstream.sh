#!/bin/bash
cd "$(dirname "$0")"
git fetch upstream
git merge upstream/master
git push origin master
echo "✓ Fork synced with upstream"
