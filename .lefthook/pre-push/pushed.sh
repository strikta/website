#!/bin/sh
# Runs as a lefthook script, which lefthook never skips for an empty push diff, unlike its commands.
exec node tool/check.ts pushed
