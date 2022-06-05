import { Stack, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';
import { AuroraPostgresCluster } from './aurora-pg';
import { AuroraWriterAZCustomResource } from './aurora-writer-az-custom-resource';
import { Autoscaler } from './autoscaler';
import { RdsPostgresInstance } from './rds-pg';

const DEFAULT_DATABASE_NAME = 'postgres';
const DEFAULT_CREATE_REPLICA = true;
const DEFAULT_SNAPSHOT_BEFORE_DESTROY = false;
// const DEFAULT_COMPUTE_LOG_GROUP = 'benchmark-log-group';
const DEFAULT_PGBENCH_SCALE_FACTOR = 1000;
const DEFAULT_PGBENCH_FILL_FACTOR = 90;
const DEFAULT_PGBENCH_CONNECTIONS = 10;
const DEFAULT_PGBENCH_THREADS = 2;
const DEFAULT_PGBENCH_PROGRESS = 60;
const DEFAULT_PGBENCH_TIME = 300;

export interface DbClusterMember {
  readonly DBInstanceIdentifier: string;
  readonly IsClusterWriter: boolean;
  readonly DBClusterParameterGroupStatus: string;
  readonly PromotionTier: number;
}

export interface BenchmarkServiceProps {
  readonly vpc: ec2.IVpc;

  readonly dbVpcSubnets?: ec2.SubnetSelection;
  readonly dbEngineVersion: rds.AuroraPostgresEngineVersion | rds.PostgresEngineVersion;
  readonly dbInstanceType?: ec2.InstanceType;
  readonly dbMultiAz?: boolean;
  readonly dbAllocatedStorage?: number;
  readonly dbStorageType?: rds.StorageType;
  readonly dbEncryptionKeyAlias?: string;
  readonly dbPIEncryptionKeyAlias?: string;
  readonly dbIops?: number;
  readonly dbDatabaseName?: string;
  readonly dbParameters?: { [key: string]: string };
  readonly dbParameterGroup?: rds.IParameterGroup;
  readonly dbCreateReplica?: boolean;

  readonly computeVpcSubnets?: ec2.SubnetSelection;
  readonly computeInstanceType?: ec2.InstanceType;
  readonly computeAsgName?: string;
  readonly computeMinSize?: number;
  readonly computeMaxSize?: number;
  readonly computeDesiredCapacity?: number;
  readonly computeUseSpot?: boolean;
  readonly computeTags?: { [key: string]: string };
  readonly computeLogGroupName?: string;

  readonly pgBenchScaleFactor?: number;
  readonly pgBenchFillFactor?: number;
  readonly pgBenchConnections?: number;
  readonly pgBenchThreads?: number;
  readonly pgBenchProgress?: number;
  readonly pgBenchTime?: number;
  readonly pgBenchSql?: string;
}

export class BenchmarkService extends Construct {
  public readonly asgName?: string;
  public readonly dbWriterEndpointAddress: string;
  public readonly dbWriterPort: number;
  public readonly dbWriterAZ?: string;
  public readonly dbReaderEndpointAddress?: string;
  public readonly dbReaderPort?: number;
  public readonly dbSecretName?: string;
  public readonly databaseName: string;
  public readonly username: string;

  public readonly logGroupName: string;
  public readonly logGroupArn: string;

  private readonly auroraPostgres?: AuroraPostgresCluster;
  private readonly rdsPostgres?: RdsPostgresInstance;
  private readonly createReplica: boolean;

  private readonly computeOnDemandPercentageAboveBaseCapacity?: number;

  public readonly pgInitDocument?: string;
  public readonly pgbenchTxDocument?: string;
  public readonly customTxDocument?: string;
  public readonly ssmStartSession?: string;

  private readonly pgBenchScaleFactor: number;
  private readonly pgBenchFillFactor: number;
  private readonly pgBenchConnections: number;
  private readonly pgBenchThreads: number;
  private readonly pgBenchProgress: number;
  private readonly pgBenchTime: number;

  constructor(scope: Construct, id: string, props: BenchmarkServiceProps) {
    super(scope, id);

    this.databaseName = props.dbDatabaseName ?? DEFAULT_DATABASE_NAME;
    this.createReplica = props.dbCreateReplica ?? DEFAULT_CREATE_REPLICA;
    this.computeOnDemandPercentageAboveBaseCapacity = props.computeUseSpot ? 0 : 100;
    this.pgBenchFillFactor = props.pgBenchFillFactor ?? DEFAULT_PGBENCH_FILL_FACTOR;
    this.pgBenchScaleFactor = props.pgBenchScaleFactor ?? DEFAULT_PGBENCH_SCALE_FACTOR;
    this.pgBenchConnections = props.pgBenchConnections ?? DEFAULT_PGBENCH_CONNECTIONS;
    this.pgBenchThreads = props.pgBenchThreads ?? DEFAULT_PGBENCH_THREADS;
    this.pgBenchProgress = props.pgBenchProgress ?? DEFAULT_PGBENCH_PROGRESS;
    this.pgBenchTime = props.pgBenchTime ?? DEFAULT_PGBENCH_TIME;

    // Create KMS key for RDS & Aurora Performance Insight
    const performanceInsightEncryptionKey = new kms.Key(this, 'DBPerformanceInsightEncryptionKey', {
      alias: props.dbPIEncryptionKeyAlias,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    // Create KMS key for RDS & Aurora Encryption at rest
    const storageEncryptionKey = new kms.Key(this, 'DBStorageEncryptionKey', {
      alias: props.dbEncryptionKeyAlias,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    if (props.dbEngineVersion instanceof rds.AuroraPostgresEngineVersion) {
      this.auroraPostgres = new AuroraPostgresCluster(this, 'AuroraPostgres', {
        vpc: props.vpc,
        vpcSubnets: props.dbVpcSubnets,
        engineVersion: props.dbEngineVersion,
        instanceType: props.dbInstanceType,
        instances: this.createReplica ? 2 : 1,
        storageEncryptionKey,
        performanceInsightEncryptionKey,
        // autoscaler,
        defaultDatabaseName: this.databaseName,
        clusterParameters: props.dbParameters,
        snapshotBeforeDestroy: DEFAULT_SNAPSHOT_BEFORE_DESTROY,
      });

      this.dbWriterEndpointAddress = this.auroraPostgres.clusterEndpoint.hostname;
      this.dbWriterPort = this.auroraPostgres.clusterEndpoint.port;
      if (this.auroraPostgres.clusterReadEndpoint) {
        this.dbReaderEndpointAddress = this.auroraPostgres.clusterReadEndpoint.hostname;
        this.dbReaderPort = this.auroraPostgres.clusterReadEndpoint.port;
      }
      this.username = this.auroraPostgres.username;
      this.dbSecretName = this.auroraPostgres.secret?.secretName;

      const auroraWriterAZ = new AuroraWriterAZCustomResource(this, 'AuroraWriterAZ', {
        clusterIdentifier: this.auroraPostgres.clusterIdentifier,
      });
      this.dbWriterAZ = auroraWriterAZ.customResource.getAttString('AvailabilityZone');

      const { subnetIds } = props.vpc.selectSubnets({
        availabilityZones: [auroraWriterAZ.customResource.getAttString('AvailabilityZone')],
        subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      });
      const autoscaler = new Autoscaler(this, 'Autoscaler', {
        vpc: props.vpc,
        availabilityZones: [auroraWriterAZ.customResource.getAttString('AvailabilityZone')],
        subnetIds: subnetIds,
        azCustomResource: auroraWriterAZ.customResource,
        instanceType: props.computeInstanceType,
        asgName: props.computeAsgName,
        minSize: props.computeMinSize,
        maxSize: props.computeMaxSize,
        desiredCapacity: props.computeDesiredCapacity,
        onDemandPercentageAboveBaseCapacity: this.computeOnDemandPercentageAboveBaseCapacity,
        tags: props.computeTags,
      });
      autoscaler.node.addDependency(auroraWriterAZ.customResource);
      this.asgName = autoscaler.asgName;

      this.auroraPostgres.grantAccess(autoscaler);

      const logGroup = new logs.LogGroup(this, 'LogGroup', {
        logGroupName: props.computeLogGroupName,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      this.logGroupName = logGroup.logGroupName;
      this.logGroupArn = logGroup.logGroupArn;

      const initDocumentParameters = {
        workingDirectory: [''],
        executionTimeout: ['3600'],
        commands: [
          `export STACK_NAME=${Stack.of(this).stackName}`,
          `export BENCHMARK_SCALE_FACTOR=${this.pgBenchScaleFactor}`,
          `export BENCHMARK_FILL_FACTOR=${this.pgBenchFillFactor}`,
          'cd /home/ec2-user/benchmark/',
          'source /home/ec2-user/benchmark/postgres_writer_env.sh',
          'nohup /home/ec2-user/benchmark/benchmark_init.sh 2>&1 &',
        ],
      };

      this.pgInitDocument = `aws ssm send-command --targets \
  --instance-ids $(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${this.asgName} | jq -r ".AutoScalingGroups[].Instances | first .InstanceId") \
  --document-name "AWS-RunShellScript" \
  --document-version "1" \
  --parameters '${JSON.stringify(initDocumentParameters)}' \
  --timeout-seconds 600 \
  --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;

      const targets = Object.keys(autoscaler.tags).map((k) => (
        `Key=tag:${k},Values=${autoscaler.tags[k]}`
      )).join(' ');

      const defaultExecDocumentParameters = {
        workingDirectory: [''],
        executionTimeout: ['3600'],
        commands: [
          `export STACK_NAME=${Stack.of(this).stackName}`,
          `export BENCHMARK_CONNECTIONS=${this.pgBenchConnections}`,
          `export BENCHMARK_THREADS=${this.pgBenchThreads}`,
          `export BENCHMARK_PROGRESS=${this.pgBenchProgress}`,
          `export BENCHMARK_TIME=${this.pgBenchTime}`,
          'cd /home/ec2-user/benchmark/',
          'source /home/ec2-user/benchmark/postgres_writer_env.sh',
          'nohup /home/ec2-user/benchmark/benchmark_default.sh 2>&1 &',
        ],
      };

      this.pgbenchTxDocument = `aws ssm send-command --targets ${targets} \
  --document-name "AWS-RunShellScript" \
  --document-version "1" \
  --parameters '${JSON.stringify(defaultExecDocumentParameters)}' \
  --timeout-seconds ${this.pgBenchTime} \
  --max-concurrency "50" \
  --max-errors "0" \
  --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;

      if (props.pgBenchSql) {
        const execDocumentParameters = {
          workingDirectory: [''],
          executionTimeout: ['3600'],
          commands: [
            `export STACK_NAME=${Stack.of(this).stackName}`,
            `export BENCHMARK_CONNECTIONS=${this.pgBenchConnections}`,
            `export BENCHMARK_THREADS=${this.pgBenchThreads}`,
            `export BENCHMARK_PROGRESS=${this.pgBenchProgress}`,
            `export BENCHMARK_TIME=${this.pgBenchTime}`,
            `export BENCHMARK_SQL_FILE=${props.pgBenchSql}`,
            'cd /home/ec2-user/benchmark/',
            'source /home/ec2-user/benchmark/postgres_env.sh',
            'nohup /home/ec2-user/benchmark/benchmark_custom.sh 2>&1 &',
          ],
        };

        this.customTxDocument = `aws ssm send-command --targets ${targets} \
    --document-name "AWS-RunShellScript" \
    --document-version "1" \
    --parameters '${JSON.stringify(execDocumentParameters)}' \
    --timeout-seconds ${this.pgBenchTime} \
    --max-concurrency "50" \
    --max-errors "0" \
    --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;
      }

    } else if (props.dbEngineVersion instanceof rds.PostgresEngineVersion) {
      this.rdsPostgres = new RdsPostgresInstance(this, 'RDSPostgres', {
        vpc: props.vpc,
        vpcSubnets: props.dbVpcSubnets,
        engineVersion: props.dbEngineVersion,
        instanceType: props.dbInstanceType,
        storageEncryptionKey,
        performanceInsightEncryptionKey,
        // autoscaler,
        multiAz: props.dbMultiAz,
        iops: props.dbIops,
        storageType: props.dbStorageType,
        allocatedStorage: props.dbAllocatedStorage,
        databaseName: this.databaseName,
        parameters: props.dbParameters,
        snapshotBeforeDestroy: DEFAULT_SNAPSHOT_BEFORE_DESTROY,
        createReplica: this.createReplica,
      });

      this.dbWriterEndpointAddress = this.rdsPostgres.dbWriterEndpointAddress;
      this.dbWriterPort = this.rdsPostgres.dbWriterPort;
      this.dbWriterAZ = this.getInstanceWriterAvailabilityZone(this.rdsPostgres.dbWriterId);

      if (this.createReplica) {
        this.dbReaderEndpointAddress = this.rdsPostgres.dbReaderInstanceEndpointAddress;
        this.dbReaderPort = this.rdsPostgres.dbReaderPort;
      }
      this.username = this.rdsPostgres.username;
      this.dbSecretName = this.rdsPostgres.secret?.secretName;

      //     const autoscaler = new Autoscaler(this, 'Autoscaler', {
      //       vpc: props.vpc,
      //       vpcSubnets: {
      //         subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
      //         availabilityZones: [this.dbWriterAZ!],
      //       },
      //       instanceType: props.computeInstanceType,
      //       asgName: props.computeAsgName,
      //       minSize: props.computeMinSize,
      //       maxSize: props.computeMaxSize,
      //       desiredCapacity: props.computeDesiredCapacity,
      //       onDemandPercentageAboveBaseCapacity: this.computeOnDemandPercentageAboveBaseCapacity,
      //       tags: props.computeTags,
      //     });
      //     this.asgName = autoscaler.asgName;

      //     this.rdsPostgres.grantAccess(autoscaler);

      const logGroup = new logs.LogGroup(this, 'LogGroup', {
        logGroupName: props.computeLogGroupName,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      this.logGroupName = logGroup.logGroupName;
      this.logGroupArn = logGroup.logGroupArn;

      //     const initDocumentParameters = {
      //       workingDirectory: [''],
      //       executionTimeout: ['3600'],
      //       commands: [
      //         `export STACK_NAME=${Stack.of(this).stackName}`,
      //         `export BENCHMARK_SCALE_FACTOR=${this.pgBenchScaleFactor}`,
      //         `export BENCHMARK_FILL_FACTOR=${this.pgBenchFillFactor}`,
      //         'cd /home/ec2-user/benchmark/',
      //         'source /home/ec2-user/benchmark/postgres_writer_env.sh',
      //         'nohup /home/ec2-user/benchmark/benchmark_init.sh 2>&1 &',
      //       ],
      //     };

      //     this.pgInitDocument = `aws ssm send-command --targets \
      // --instance-ids $(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${this.asgName} | jq -r ".AutoScalingGroups[].Instances | first .InstanceId") \
      // --document-name "AWS-RunShellScript" \
      // --document-version "1" \
      // --parameters '${JSON.stringify(initDocumentParameters)}' \
      // --timeout-seconds 600 \
      // --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;

      //     const targets = Object.keys(autoscaler.tags).map((k) => (
      //       `Key=tag:${k},Values=${autoscaler.tags[k]}`
      //     )).join(' ');

      //     const defaultExecDocumentParameters = {
      //       workingDirectory: [''],
      //       executionTimeout: ['3600'],
      //       commands: [
      //         `export STACK_NAME=${Stack.of(this).stackName}`,
      //         `export BENCHMARK_CONNECTIONS=${this.pgBenchConnections}`,
      //         `export BENCHMARK_THREADS=${this.pgBenchThreads}`,
      //         `export BENCHMARK_PROGRESS=${this.pgBenchProgress}`,
      //         `export BENCHMARK_TIME=${this.pgBenchTime}`,
      //         'cd /home/ec2-user/benchmark/',
      //         'source /home/ec2-user/benchmark/postgres_writer_env.sh',
      //         'nohup /home/ec2-user/benchmark/benchmark_default.sh 2>&1 &',
      //       ],
      //     };

      //     this.pgbenchTxDocument = `aws ssm send-command --targets ${targets} \
      // --document-name "AWS-RunShellScript" \
      // --document-version "1" \
      // --parameters '${JSON.stringify(defaultExecDocumentParameters)}' \
      // --timeout-seconds ${this.pgBenchTime} \
      // --max-concurrency "50" \
      // --max-errors "0" \
      // --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;

      //     if (props.pgBenchSql) {
      //       const execDocumentParameters = {
      //         workingDirectory: [''],
      //         executionTimeout: ['3600'],
      //         commands: [
      //           `export STACK_NAME=${Stack.of(this).stackName}`,
      //           `export BENCHMARK_CONNECTIONS=${this.pgBenchConnections}`,
      //           `export BENCHMARK_THREADS=${this.pgBenchThreads}`,
      //           `export BENCHMARK_PROGRESS=${this.pgBenchProgress}`,
      //           `export BENCHMARK_TIME=${this.pgBenchTime}`,
      //           `export BENCHMARK_SQL_FILE=${props.pgBenchSql}`,
      //           'cd /home/ec2-user/benchmark/',
      //           'source /home/ec2-user/benchmark/postgres_env.sh',
      //           'nohup /home/ec2-user/benchmark/benchmark_custom.sh 2>&1 &',
      //         ],
      //       };

      //       this.customTxDocument = `aws ssm send-command --targets ${targets} \
      //   --document-name "AWS-RunShellScript" \
      //   --document-version "1" \
      //   --parameters '${JSON.stringify(execDocumentParameters)}' \
      //   --timeout-seconds ${this.pgBenchTime} \
      //   --max-concurrency "50" \
      //   --max-errors "0" \
      //   --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;
      //     }
    } else {
      throw new Error('dbEngineVersion must be either instance of AuroraPostgresEngineVersion or PostgresEngineVersion');
    }

  }

  //     const autoscaler = new Autoscaler(this, 'Autoscaler', {
  //       vpc: props.vpc,
  //       ...this.dbWriterAZ && {
  //         vpcSubnets: {
  //           subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
  //           availabilityZones: [this.dbWriterAZ],
  //         },
  //       },
  //       instanceType: props.computeInstanceType,
  //       asgName: props.computeAsgName,
  //       minSize: props.computeMinSize,
  //       maxSize: props.computeMaxSize,
  //       desiredCapacity: props.computeDesiredCapacity,
  //       onDemandPercentageAboveBaseCapacity: this.computeOnDemandPercentageAboveBaseCapacity,
  //       tags: props.computeTags,
  //     });
  //     this.asgName = autoscaler.asgName;

  //     if (this.auroraPostgres) {
  //       this.auroraPostgres.grantAccess(autoscaler);
  //     }

  //     if (this.rdsPostgres) {
  //       this.rdsPostgres.grantAccess(autoscaler);
  //     }

  //     const logGroup = new logs.LogGroup(this, 'LogGroup', {
  //       logGroupName: props.computeLogGroupName,
  //       removalPolicy: RemovalPolicy.DESTROY,
  //     });
  //     this.logGroupName = logGroup.logGroupName;
  //     this.logGroupArn = logGroup.logGroupArn;

  //     const initDocumentParameters = {
  //       workingDirectory: [''],
  //       executionTimeout: ['3600'],
  //       commands: [
  //         `export STACK_NAME=${Stack.of(this).stackName}`,
  //         `export BENCHMARK_SCALE_FACTOR=${this.pgBenchScaleFactor}`,
  //         `export BENCHMARK_FILL_FACTOR=${this.pgBenchFillFactor}`,
  //         'cd /home/ec2-user/benchmark/',
  //         'source /home/ec2-user/benchmark/postgres_writer_env.sh',
  //         'nohup /home/ec2-user/benchmark/benchmark_init.sh 2>&1 &',
  //       ],
  //     };

  //     this.pgInitDocument = `aws ssm send-command --targets \
  // --instance-ids $(aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names ${this.asgName} | jq -r ".AutoScalingGroups[].Instances | first .InstanceId") \
  // --document-name "AWS-RunShellScript" \
  // --document-version "1" \
  // --parameters '${JSON.stringify(initDocumentParameters)}' \
  // --timeout-seconds 600 \
  // --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;

  //     const targets = Object.keys(autoscaler.tags).map((k) => (
  //       `Key=tag:${k},Values=${autoscaler.tags[k]}`
  //     )).join(' ');

  //     const defaultExecDocumentParameters = {
  //       workingDirectory: [''],
  //       executionTimeout: ['3600'],
  //       commands: [
  //         `export STACK_NAME=${Stack.of(this).stackName}`,
  //         `export BENCHMARK_CONNECTIONS=${this.pgBenchConnections}`,
  //         `export BENCHMARK_THREADS=${this.pgBenchThreads}`,
  //         `export BENCHMARK_PROGRESS=${this.pgBenchProgress}`,
  //         `export BENCHMARK_TIME=${this.pgBenchTime}`,
  //         'cd /home/ec2-user/benchmark/',
  //         'source /home/ec2-user/benchmark/postgres_writer_env.sh',
  //         'nohup /home/ec2-user/benchmark/benchmark_default.sh 2>&1 &',
  //       ],
  //     };

  //     this.pgbenchTxDocument = `aws ssm send-command --targets ${targets} \
  // --document-name "AWS-RunShellScript" \
  // --document-version "1" \
  // --parameters '${JSON.stringify(defaultExecDocumentParameters)}' \
  // --timeout-seconds ${this.pgBenchTime} \
  // --max-concurrency "50" \
  // --max-errors "0" \
  // --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;

  //     if (props.pgBenchSql) {
  //       const execDocumentParameters = {
  //         workingDirectory: [''],
  //         executionTimeout: ['3600'],
  //         commands: [
  //           `export STACK_NAME=${Stack.of(this).stackName}`,
  //           `export BENCHMARK_CONNECTIONS=${this.pgBenchConnections}`,
  //           `export BENCHMARK_THREADS=${this.pgBenchThreads}`,
  //           `export BENCHMARK_PROGRESS=${this.pgBenchProgress}`,
  //           `export BENCHMARK_TIME=${this.pgBenchTime}`,
  //           `export BENCHMARK_SQL_FILE=${props.pgBenchSql}`,
  //           'cd /home/ec2-user/benchmark/',
  //           'source /home/ec2-user/benchmark/postgres_env.sh',
  //           'nohup /home/ec2-user/benchmark/benchmark_custom.sh 2>&1 &',
  //         ],
  //       };

  //       this.customTxDocument = `aws ssm send-command --targets ${targets} \
  //   --document-name "AWS-RunShellScript" \
  //   --document-version "1" \
  //   --parameters '${JSON.stringify(execDocumentParameters)}' \
  //   --timeout-seconds ${this.pgBenchTime} \
  //   --max-concurrency "50" \
  //   --max-errors "0" \
  //   --cloud-watch-output-config '{"CloudWatchLogGroupName":"${this.logGroupName}","CloudWatchOutputEnabled":true}'`;
  //     }

  //     this.ssmStartSession = `aws ssm start-session \
  // --target $(aws autoscaling describe-auto-scaling-instances | \
  // jq -r \'.AutoScalingInstances[] | select (.AutoScalingGroupName == "${this.asgName}") | .InstanceId\')`;
  //   }

  private getInstanceWriterAvailabilityZone(instanceIdentifier: string): string | undefined {
    const crWriterAZ = new cr.AwsCustomResource(this, 'GetWriterAZ', {
      onCreate: {
        service: 'RDS',
        action: 'describeDBInstances',
        parameters: {
          DBInstanceIdentifier: instanceIdentifier,
        },
        physicalResourceId: cr.PhysicalResourceId.of(`cr-${instanceIdentifier}`),
        outputPaths: ['DBInstances.0.AvailabilityZone'],
      },
      policy: cr.AwsCustomResourcePolicy.fromSdkCalls({
        resources: cr.AwsCustomResourcePolicy.ANY_RESOURCE,
      }),
    });

    return crWriterAZ.getResponseField('DBInstances.0.AvailabilityZone');
  }
}