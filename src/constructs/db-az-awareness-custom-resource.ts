import * as path from 'path';
import { CustomResource, Duration } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface DBAvailabilityZoneAwarenessCustomResourceProps {
  readonly vpc: ec2.IVpc;
  readonly dbEngineVersion: rds.AuroraPostgresEngineVersion | rds.PostgresEngineVersion;
  readonly clusterIdentifier?: string;
  readonly instanceIdentifier?: string;
}

export class DBAvailabilityZoneAwarenessCustomResource extends Construct {
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: DBAvailabilityZoneAwarenessCustomResourceProps) {
    super(scope, id);

    const role = new iam.Role(this, 'DBAvailabilityZoneAwarenessLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ec2:DescribeVPCs',
        'ec2:DescribeSubnets',
        'rds:DescribeDBClusters',
        'rds:DescribeDBInstances',
      ],
      resources: ['*'],
    }));

    const onEventHandler = new lambda.Function(this, 'DBAvailabilityZoneAwarenessOnEventFn', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'db_az_awareness_event_handler.on_event',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-handler')),
      role,
    });

    const isCompleteHandler = new lambda.Function(this, 'DBAvailabilityZoneAwarenessIsCompleteFn', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'db_az_awareness_event_handler.is_complete',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-handler')),
      role,
    });

    const crProvider = new cr.Provider(this, 'Provider', {
      onEventHandler,
      isCompleteHandler,
      queryInterval: Duration.seconds(30),
    });

    this.customResource = new CustomResource(this, 'DBAvailabilityZoneAwarenessCustomResource', {
      serviceToken: crProvider.serviceToken,
      properties: {
        VpcId: props.vpc.vpcId,
        ClusterIdentifier: props.clusterIdentifier,
        InstanceIdentifier: props.instanceIdentifier,
      },
    });
  }

  public getWriterAvailabilityZone() {
    return this.customResource.getAttString('AvailabilityZone');
  }

  public getSubnetId() {
    return this.customResource.getAttString('SubnetId');
  }
}