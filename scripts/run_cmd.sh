#!/bin/bash

set -x

STACK_NAME=$(cdk ls)
eval $(aws cloudformation describe-stacks \
  --stack-name $STACK_NAME \
  --query "Stacks[].Outputs[?OutputKey=='$1'].OutputValue" \
  --output text)