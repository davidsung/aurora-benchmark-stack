# from cfnresponse import send, SUCCESS

import boto3
import botocore
import json

rds = boto3.client('rds')

def handler(event, context):
    print("Received event: " + json.dumps(event, indent=2))

    props = event['ResourceProperties']
    cluster_identifier = props['ClusterIdentifier']

    if event['RequestType'] == 'Create':

        try:
            clusters = rds.describe_db_clusters(
                DBClusterIdentifier=cluster_identifier,
            )
            print(f"Found cluster {clusters['DBClusters']}")
            return { 'PhysicalResourceId': f'WriterAZCustomResource{cluster_identifier}'}

        except botocore.exceptions.ClientError as err:
            print(f"{err}")
    
    else:
        physical_id = event["PhysicalResourceId"]
        return { 'PhysicalResourceId': physical_id }

    raise Exception(f'Invalid request type: {event}')