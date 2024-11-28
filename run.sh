#!/bin/bash
export NODE_ENV=production
export DEBUG=apps*
export DEBUG_COLORS=true
pm2 start ./src/index.js --max-memory-restart 1000MB --name three-oracle --time