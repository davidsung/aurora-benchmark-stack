import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { AuroraPostgresCluster } from '../../src/constructs/aurora-pg';

test('Aurora Cluster Created', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new AuroraPostgresCluster(stack, 'AuroraPostgresClusterConstruct', {
    vpc,
  });
  // THEN
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::RDS::DBCluster', 1);
});

test('Aurora Cluster has Default Database', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new AuroraPostgresCluster(stack, 'AuroraPostgresClusterConstruct', {
    vpc,
    defaultDatabaseName: 'testdb',
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBCluster', {
    DatabaseName: 'testdb',
  });
});

test('Aurora Cluster match specified number of instances', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new AuroraPostgresCluster(stack, 'AuroraPostgresClusterConstruct', {
    vpc,
    instances: 3,
  });
  // THEN
  const template = Template.fromStack(stack);
  template.resourceCountIs('AWS::RDS::DBInstance', 2);
});

test('Aurora Cluster match specified instance type', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new AuroraPostgresCluster(stack, 'AuroraPostgresClusterConstruct', {
    vpc,
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    DBInstanceClass: 'db.t4g.medium',
  });
});

test('Aurora Cluster Parameter Group', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new AuroraPostgresCluster(stack, 'AuroraPostgresClusterConstruct', {
    vpc,
    clusterParameters: {
      max_connections: '1000',
    },
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBClusterParameterGroup', {
    Parameters: {
      max_connections: '1000',
    },
  });
});
