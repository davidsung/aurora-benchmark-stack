# postgreSQL connection environment variables
export BENCHMARK_HOST=AURORA_WRITER_NODE_HOST
export BENCHMARK_PORT=DATABASE_PORT
export BENCHMARK_DB=DATABASE_NAME
export PGPASSWORD=DATABASE_PASSSWORD
export BENCHMARK_USER=DATABASE_USER
# pgbench control environment variables
export BENCHMARK_CONNECTIONS=16
export BENCHMARK_THREADS=8
export BENCHMARK_SQL_FILE=transaction_group_1.sql
# time in seconds to run test
export BENCHMARK_TIME=300
# run the benchmark test
cd /home/ec2-user/benchmark/
nohup /home/ec2-user/benchmark/benchmark.sh 2>&1 &