#!/bin/bash
export NODE_ENV=production
export DEBUG=apps*
pm2 start start.sh --name three-apps --time