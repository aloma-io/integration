#!/bin/sh -e

cd /connector/

exec node src/index.js $@
