import * as path from 'path';
import { CustomResource } from 'aws-cdk-lib';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

export interface AuroraWriterAZCustomResourceProps {
  readonly clusterIdentifier: string;
}

export class AuroraWriterAZCustomResource extends Construct {
  public readonly writerAvaibilityZone: string;
  public readonly customResource: CustomResource;

  constructor(scope: Construct, id: string, props: AuroraWriterAZCustomResourceProps) {
    super(scope, id);

    const role = new iam.Role(this, 'AuroraWriterAZRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
    });

    role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'));

    role.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'rds:DescribeDBClusters',
        'rds:DescribeDBInstances',
      ],
      resources: ['*'],
    }));

    const onEventHandler = new lambda.Function(this, 'CustomResourceLambda', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'aurora_writer_az_event_handler.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-handler')),
      role,
    });

    const isCompleteHandler = new lambda.Function(this, 'RDSGetWriterAZIsCompleteFn', {
      runtime: lambda.Runtime.PYTHON_3_8,
      handler: 'aurora_writer_az_is_complete_handler.is_complete',
      code: lambda.Code.fromAsset(path.join(__dirname, 'lambda-handler')),
      role,
    });

    const crProvider = new cr.Provider(this, 'Provider', {
      onEventHandler,
      isCompleteHandler,
    });

    this.customResource = new CustomResource(this, 'WriterAvailabilityZoneCustomResource', {
      serviceToken: crProvider.serviceToken,
      properties: {
        ClusterIdentifier: props.clusterIdentifier,
      },
    });

    this.writerAvaibilityZone = this.customResource.getAttString('AvailabilityZone');

  }
}