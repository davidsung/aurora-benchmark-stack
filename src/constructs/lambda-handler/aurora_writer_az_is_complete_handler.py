
import boto3

rds = boto3.client('rds')

def is_complete(event, context):
    physical_id = event["PhysicalResourceId"]
    print(event)
    is_ready = False

    request_type = event['RequestType'].lower()
    props = event['ResourceProperties']
    cluster_identifier = props['ClusterIdentifier']
    
    if request_type == 'create':
        try:
            clusters = rds.describe_db_clusters(
                DBClusterIdentifier=cluster_identifier,
            )
            print(f"Found Cluster Members {clusters['DBClusters']}")
            writer_members = clusters['DBClusters'][0]['DBClusterMembers']
            for member in writer_members:
                if member['IsClusterWriter']:
                    instance_identifier = member['DBInstanceIdentifier']
                    print(f"Found Writer Instance Identifier {instance_identifier}")
                    writer_instances = rds.describe_db_instances(
                        DBInstanceIdentifier=instance_identifier,
                    )
                    print(f"Describe Write Instances {writer_instances['DBInstances']}")
                    if len(writer_instances['DBInstances']) > 0:
                        if 'AvailabilityZone' in writer_instances['DBInstances'][0]:
                            print(f"Writer Availability Zone {writer_instances['DBInstances'][0]['AvailabilityZone']}")
                            return {
                                'Data': {
                                    'AvailabilityZone': writer_instances['DBInstances'][0]['AvailabilityZone'],
                                },
                                'IsComplete': True
                            }
        except rds.exceptions.DBClusterNotFoundFault:
            is_ready = False

    if request_type == 'update':
        is_ready = True;

    if request_type == 'delete':
        is_ready = True;
        
    return { 'IsComplete': is_ready }