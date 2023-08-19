#!/bin/bash
export NODE_ENV=production
export DEBUG=apps*
export DEBUG_COLORS=true
pm2 start start.sh --name three-oracle --time