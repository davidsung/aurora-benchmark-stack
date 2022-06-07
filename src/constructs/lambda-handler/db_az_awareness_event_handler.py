import boto3
import botocore
import json

rds = boto3.client('rds')
ec2 = boto3.client('ec2')

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
  
  return None

def get_instance_availability_zone_and_subnet_id(vpc_id, instance_identifier):
  az = get_instance_availability_zone(instance_identifier)
  if az != None:
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
    if len(subnets['Subnets']) > 0:
      if 'SubnetId' in subnets['Subnets'][0]:
        info = {}
        info['AvailabilityZone'] = az;
        info['SubnetId'] = subnets['Subnets'][0]['SubnetId']
        return info

  return None

def on_event(event, context):
  print(event)
  request_type = event['RequestType']

  if request_type == 'Create': return on_create(event)
  if request_type == 'Update': return on_update(event)
  if request_type == 'Delete': return on_delete(event)
  raise Exception("Invalid request type: %s" % request_type)

def on_create(event):
  props = event['ResourceProperties']
  print("create new resource with props %s" % props)

  if 'ClusterIdentifier' in props:
    cluster_identifier = props['ClusterIdentifier']
    clusters = rds.describe_db_clusters(
      DBClusterIdentifier=cluster_identifier,
    )
    print(f"Found cluster {clusters['DBClusters']}")
    # add your create code here...
    physical_id = f'DBAZAwarenessCustomResource{cluster_identifier}'

  elif 'InstanceIdentifier' in props:
    instance_identifier = props['InstanceIdentifier']
    instances = rds.describe_db_instances(
      DBInstanceIdentifier=instance_identifier,
    )
    print(f"Found instance {instances['DBInstances']}")
    physical_id = f'DBAZAwarenessCustomResource{instance_identifier}'
  
  else:
    raise Exception(f"Neither ClusterIdentifier nor InstanceIdentifier was found in ResourceProperties, props: {props}")

  return { 'PhysicalResourceId': physical_id }

def on_update(event):
  physical_id = event["PhysicalResourceId"]
  props = event["ResourceProperties"]
  print("update resource %s with props %s" % (physical_id, props))
  return { 'IsComplete': True }

def on_delete(event):
  physical_id = event["PhysicalResourceId"]
  print("delete resource %s" % physical_id)
  return { 'IsComplete': True }

def is_complete(event, context):
  physical_id = event["PhysicalResourceId"]
  request_type = event["RequestType"]

  # check if resource is stable based on request_type
  is_ready = False

  if request_type == 'Update' or request_type == 'Delete':
    is_ready = True
    return { 'IsComplete': is_ready }
  
  if request_type == 'Create':
    props = event["ResourceProperties"]
    vpc_id = props["VpcId"]

    if 'ClusterIdentifier' in props:
      cluster_identifier = props["ClusterIdentifier"]
      cluster_members = get_cluster_members(cluster_identifier)
      for member in cluster_members:
        if member['IsClusterWriter']:
          instance_identifier = member['DBInstanceIdentifier']
          info = get_instance_availability_zone_and_subnet_id(vpc_id, instance_identifier)
          if info != None:
            response = {}
            response['Data'] = info
            response['IsComplete'] = True
            return response

    elif 'InstanceIdentifier' in props:
      instance_identifier = props['InstanceIdentifier']
      info = get_instance_availability_zone_and_subnet_id(vpc_id, instance_identifier)
      if info != None:
        response = {}
        response['Data'] = info
        response['IsComplete'] = True
        return response

  return { 'IsComplete': is_ready }
