#!/bin/sh
set -eu
# A newly mounted Fly volume is root-owned. Browser and app run as the node user.
mkdir -p "${DATA_DIR:-/data}"
chown node:node "${DATA_DIR:-/data}"
exec gosu node "$@"
