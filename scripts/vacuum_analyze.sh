#!/bin/bash

psql -c "VACUUM (VERBOSE, ANALYZE) $1"