#!/bin/bash
export NODE_ENV=production
export DEBUG=apps*
export DEBUG_COLORS=true
pm2 start ./src/main.js --max_memory_restart 1000MB --name three-oracle