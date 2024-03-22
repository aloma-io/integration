#!/bin/sh -e

cd /connector/

exec node build/index.mjs $@
