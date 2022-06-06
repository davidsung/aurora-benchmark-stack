import boto3
import botocore
import json

rds = boto3.client('rds')
ec2 = boto3.client('ec2')

def on_event(event, context):
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

def is_complete(event, context):
    physical_id = event["PhysicalResourceId"]
    print(event)
    is_ready = False

    request_type = event['RequestType'].lower()
    props = event['ResourceProperties']
    vpc_id = props['VpcId']
    cluster_identifier = props['ClusterIdentifier']
    # instance_identifier = props['InstanceIdentifier']
    
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
                            az = writer_instances['DBInstances'][0]['AvailabilityZone']
                            subnets = ec2.describe_subnets(
                                Filters=[
                                    {
                                        'Name': 'vpc-id',
                                        'Values': [
                                            vpc_id,
                                        ]
                                    },
                                    {
                                        'Name': 'availability-zone',
                                        'Values': [
                                            az,
                                        ]
                                    },
                                    {
                                        'Name': 'tag:subnet-type',
                                        'Values': [
                                            'private',
                                        ]
                                    },
                                ],
                            )
                            subnet_id = subnets['Subnets'][0]['SubnetId']
                            return {
                                'Data': {
                                    'AvailabilityZone': az,
                                    'SubnetId': subnet_id,
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

def get_cluster_members(cluster_identifier):
    try:
        clusters = rds.describe_db_clusters(
            DBClusterIdentifier=cluster_identifier,
        )
        print(f"Found Cluster Members {clusters['DBClusters']}")
    except rds.exceptions.DBClusterNotFoundFault as err:
        raise err
        
    return clusters['DBClusters'][0]['DBClusterMembers']

def get_instance_availability_zone(instance_identifier):
    instances = rds.describe_db_instances(
        DBInstanceIdentifier=instance_identifier,
    )
    print(f"Describe Instance {instances['DBInstances']}")
    if len(instances['DBInstances']) > 0:
        if 'AvailabilityZone' in instances['DBInstances'][0]:
            print(f"Instance Availability Zone {instances['DBInstances'][0]['AvailabilityZone']}")
            return instances['DBInstances'][0]['AvailabilityZone']
