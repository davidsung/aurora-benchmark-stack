#!/bin/bash

psql -P pager=off -c "select * from pg_stat_statements"
psql -P pager=off -c "select * from pg_stat_all_tables"
psql -P pager=off -c "select * from pg_statio_all_tables"
