#!/bin/bash

aws cloudformation describe-stacks --stack-name $(cdk list) | jq '.Stacks | .[] | .Outputs | reduce .[] as $i ({}; .[$i.OutputKey] = $i.OutputValue)'