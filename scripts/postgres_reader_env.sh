#!/bin/bash

INSTANCE_ID=$(ec2-metadata -i | cut -d ' ' -f2)
STACK_NAME=$(aws ec2 describe-tags --filter "Name=resource-id,Values=$INSTANCE_ID" | jq -r '.Tags[] | select(.Key == "aws:cloudformation:stack-name") | .Value')

export PGHOST=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[].Outputs[?OutputKey=='DBReaderEndpoint'].OutputValue" \
  --output text)
export PGPORT=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[].Outputs[?OutputKey=='DBReaderPort'].OutputValue" \
  --output text)
export PGDATABASE=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[].Outputs[?OutputKey=='DBDatabaseName'].OutputValue" \
  --output text)
export PGUSER=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[].Outputs[?OutputKey=='DBUsername'].OutputValue" \
  --output text)
PG_SECRET_ID=$(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[].Outputs[?OutputKey=='DBSecretId'].OutputValue" \
  --output text)  
export PGPASSWORD=$(aws secretsmanager get-secret-value \
  --secret-id $PG_SECRET_ID | jq -r ".SecretString | fromjson | .password")
