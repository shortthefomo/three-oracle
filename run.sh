#!/bin/bash
export NODE_ENV=production
export DEBUG=apps*
export DEBUG_COLORS=true
pm2 start "yarn dev" ./src/index.js --name three-oracle --time