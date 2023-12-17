import * as path from 'path';
import { Stack, Tags } from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import { Asset } from 'aws-cdk-lib/aws-s3-assets';
import { Construct } from 'constructs';
import { DBAvailabilityZoneAwarenessCustomResource } from './db-az-awareness-custom-resource';

const DEFAULT_INSTANCE_TYPE: ec2.InstanceType = ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO);
const DEFAULT_MIN_SIZE: number = 1;
const DEFAULT_MAX_SIZE: number = 1;
// const DEFAULT_DESIRED_CAPACITY: number = 1;
const DEFAULT_ON_DEMAND_PCT_ABOVE_BASE_CAPACITY: number = 100;
const DEFAULT_AUTOSCALER_TAGS: { [key: string]: string } = {
  benchmark: 'transaction_group',
};

// const SSM_DOCUMENT_PGBENCH = `aws ssm send-command --targets --instance-ids $(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${benchmarkService.asgName} | jq -r ".AutoScalingGroups[].Instances | first .InstanceId") --document-name "AWS-RunShellScript" --document-version "1" --parameters '{"workingDirectory":[""],"executionTimeout":["3600"],"commands":["# postgreSQL connection environment variables","# pgbench control environment variables","export BENCHMARK_SCALE_FACTOR=10000","export BENCHMARK_FILL_FACTOR=90","# run the benchmark init","cd /home/ec2-user/benchmark/","source /home/ec2-user/benchmark/aurora_postgres_env.sh","nohup /home/ec2-user/benchmark/benchmark_init.sh 2>&1 &"]}' --timeout-seconds 600 --cloud-watch-output-config '{"CloudWatchLogGroupName":"${benchmarkService.logGroupName}","CloudWatchOutputEnabled":true}'`;

export interface AutoscalerProps {
  readonly asgName?: string;
  readonly vpc: ec2.IVpc;
  readonly clusterIdentifier?: string;
  readonly instanceIdentifier?: string;
  readonly availabilityZones?: string[];
  readonly instanceType?: ec2.InstanceType;
  readonly machineImage?: ec2.IMachineImage;
  readonly role?: iam.IRole;
  readonly detailedMonitoring?: boolean;
  readonly minSize?: number;
  readonly maxSize?: number;
  readonly desiredCapacity?: number;
  readonly onDemandPercentageAboveBaseCapacity?: number;
  readonly tags?: {
    [key: string]: string;
  };
}

export class Autoscaler extends Construct implements ec2.IConnectable, iam.IGrantable {
  // private readonly _asgName: string;
  private readonly instanceType: ec2.InstanceType;
  private readonly maxSize: number;
  private readonly minSize: number;
  private readonly role: iam.IRole;
  private readonly onDemandPercentageAboveBaseCapacity: number;

  public readonly asgName?: string;
  public readonly connections: ec2.Connections;
  public readonly grantPrincipal: iam.IPrincipal;
  public readonly tags: {
    [key: string]: string;
  };

  constructor(scope: Construct, id: string, props: AutoscalerProps) {
    super(scope, id);

    // Add tags to subnets for custom resource lambda to identify the desired subnets
    props.vpc.privateSubnets.forEach(subnet => {
      Tags.of(subnet).add('subnet-type', 'private');
    });

    const azAwarenessCustomResource = new DBAvailabilityZoneAwarenessCustomResource(this, 'DBAvailabilityZoneAwarenessCustomResource', {
      vpc: props.vpc,
      clusterIdentifier: props.clusterIdentifier,
      instanceIdentifier: props.instanceIdentifier,
    });

    // this._asgName = props.asgName ?? `${Stack.of(this).stackName}-autoscaler-asg`;
    this.instanceType = props.instanceType ?? DEFAULT_INSTANCE_TYPE;
    this.maxSize = props.maxSize ?? DEFAULT_MAX_SIZE;
    this.minSize = props.minSize ?? DEFAULT_MIN_SIZE;
    // this.desiredCapacity = props.desiredCapacity ?? DEFAULT_DESIRED_CAPACITY;
    this.onDemandPercentageAboveBaseCapacity = props.onDemandPercentageAboveBaseCapacity ?? DEFAULT_ON_DEMAND_PCT_ABOVE_BASE_CAPACITY;
    this.tags = props.tags ?? DEFAULT_AUTOSCALER_TAGS;

    this.role = props.role ?? new iam.Role(this, 'Role', {
      assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
    });
    this.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore'));
    this.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));
    const policy = new iam.Policy(this, 'Policy', {
      document: new iam.PolicyDocument({
        statements: [new iam.PolicyStatement({
          actions: [
            'cloudformation:DescribeStacks',
          ],
          resources: [
            '*',
          ],
        })],
      }),
    });
    policy.attachToRole(this.role);

    const userData = ec2.UserData.forLinux();
    userData.addCommands(
      'sudo yum install -y amazon-linux-extras',
      'sudo amazon-linux-extras enable postgresql12',
      'sudo yum clean metadata',
      'sudo amazon-linux-extras install postgresql12',
      'sudo yum install -y jq postgresql-contrib',
      'mkdir /home/ec2-user/benchmark',
      'cd /home/ec2-user/benchmark',
    );

    const asset = new Asset(this, 'ScriptsAsset', {
      path: path.join(__dirname, '../../scripts'),
    });
    userData.addS3DownloadCommand({
      localFile: `/home/ec2-user/benchmark/${asset.s3ObjectKey}`,
      bucket: asset.bucket,
      bucketKey: asset.s3ObjectKey,
    });
    userData.addCommands(
      `aws configure set region ${Stack.of(this).region}`,
      'cp -r /root/.aws /home/ec2-user/',
      'sudo chown -R ec2-user: /home/ec2-user/.aws',
      `unzip ${asset.s3ObjectKey}`,
      'cp -f /home/ec2-user/benchmark/ulimits.conf /etc/security/limits.conf',
      'sudo chown -R ec2-user: /home/ec2-user/benchmark',
      'sudo chmod +x /home/ec2-user/benchmark/*.sh',
    );

    const securityGroup = new ec2.SecurityGroup(this, 'AutoscalerSecurityGroup', {
      vpc: props.vpc,
    });

    const ec2LaunchTemplate = new ec2.LaunchTemplate(this, 'AutoscalerLaunchTemplate', {
      instanceType: this.instanceType,
      machineImage: props.machineImage ?? ec2.MachineImage.latestAmazonLinux2(),
      role: this.role,
      detailedMonitoring: props.detailedMonitoring,
      securityGroup,
      userData,
    });
    asset.grantRead(ec2LaunchTemplate);
    asset.node.addDependency(ec2LaunchTemplate);

    const asg = new autoscaling.AutoScalingGroup(this, 'Autoscaler', {
      vpc: props.vpc,
      // Hacky way to suppress rendering Properties `VPCZoneIdentifier` by supplying empty azs
      vpcSubnets: {
        availabilityZones: [],
      },
      minCapacity: this.minSize,
      maxCapacity: this.maxSize,
      desiredCapacity: props.desiredCapacity,
      mixedInstancesPolicy: {
        launchTemplate: ec2LaunchTemplate,
        instancesDistribution: {
          onDemandPercentageAboveBaseCapacity: this.onDemandPercentageAboveBaseCapacity,
        },
      },
    });
    // Hacky way to override the AutoScalingGroup VPCZoneIdentifier with desired subnet id obtained from custom resource
    const cfnAsg = asg.node.defaultChild as autoscaling.CfnAutoScalingGroup;
    cfnAsg.addPropertyOverride('VPCZoneIdentifier.0', azAwarenessCustomResource.getSubnetId());

    Object.keys(this.tags).forEach(k => {
      Tags.of(asg).add(k, this.tags![k]);
    });

    this.asgName = asg.autoScalingGroupName;
    this.connections = ec2LaunchTemplate.connections;
    this.grantPrincipal = ec2LaunchTemplate.grantPrincipal;
  }
}