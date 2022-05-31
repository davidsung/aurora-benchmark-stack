import * as cdk from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import { RdsPostgresInstance } from '../../src/constructs/rds-pg';

test('RDS Instance Created', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new RdsPostgresInstance(stack, 'RDSPostgresConstruct', {
    vpc,
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResource('AWS::RDS::DBInstance', {});
});

test('RDS DB Instance is Multi AZ', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new RdsPostgresInstance(stack, 'RDSDbInstanceConstruct', {
    vpc,
    instanceType: ec2.InstanceType.of(ec2.InstanceClass.T4G, ec2.InstanceSize.MEDIUM),
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    DBInstanceClass: 'db.t4g.medium',
  });
});

test('RDS DB Instance is Multi AZ', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new RdsPostgresInstance(stack, 'RDSDbInstanceConstruct', {
    vpc,
    multiAz: true,
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    MultiAZ: true,
  });
});

test('RDS DB Instance has Default Database', () => {
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new RdsPostgresInstance(stack, 'RDSDbInstanceConstruct', {
    vpc,
    databaseName: 'testdb',
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBInstance', {
    DBName: 'testdb',
  });
});

test('RDS Parameter Group', () => {
  // GIVEN
  const stack = new cdk.Stack();
  const vpc = new ec2.Vpc(stack, 'VPC');
  // WHEN
  new RdsPostgresInstance(stack, 'RDSDbInstanceConstruct', {
    vpc,
    databaseName: 'testdb',
    parameters: {
      max_connections: '1000',
    },
  });
  // THEN
  const template = Template.fromStack(stack);
  template.hasResourceProperties('AWS::RDS::DBParameterGroup', {
    Parameters: {
      max_connections: '1000',
    },
  });
});
