#!/bin/bash

psql -P pager=off c "CREATE EXTENSION IF NOT EXISTS pg_stat_statements WITH SCHEMA public"