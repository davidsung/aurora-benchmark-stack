import { App, Stack, StackProps, CfnOutput, Token } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import { Construct } from 'constructs';
import { BenchmarkService } from './constructs/benchmark';

// const DEFAULT_VPC_NAME = 'benchmark-db-vpc';
const DEFAULT_VPC_CIDR = '10.0.0.0/16';

export interface BenchmarkDbStackProps extends StackProps {
  readonly vpcName?: string;
  readonly vpcCidr?: string;

  readonly dbEngineVersion?: rds.AuroraPostgresEngineVersion | rds.PostgresEngineVersion;
  readonly dbInstanceType?: ec2.InstanceType;
  readonly dbMultiAz?: boolean;
  readonly dbAllocatedStorage?: number;
  readonly dbStorageType?: rds.StorageType;
  readonly dbIops?: number;
  readonly dbParamaterGroup?: rds.IParameterGroup;
  readonly dbParameters?: {
    [key: string]: string;
  };

  readonly computeInstanceType?: ec2.InstanceType;
  readonly computeAutoscalerMinCapacity?: number;
  readonly computeAutoscalerMaxCapacity?: number;
  readonly computeAutoscalerDesiredCapacity?: number;
  readonly computeUseSpot?: boolean;
  readonly computeAutoscalerTags?: {
    [key: string]: string;
  };
}

export class BenchmarkDbStack extends Stack {
  private readonly vpcCidr: string;
  private readonly vpcName: string;

  constructor(scope: Construct, id: string, props: BenchmarkDbStackProps = {}) {
    super(scope, id, props);

    this.vpcCidr = props.vpcCidr ?? DEFAULT_VPC_CIDR;
    this.vpcName = props.vpcName ?? `${Stack.of(this).stackName}-vpc`;

    const vpc = new ec2.Vpc(this, 'Vpc', {
      vpcName: this.vpcName,
      cidr: this.vpcCidr,
      natGateways: 1,
      subnetConfiguration: [
        {
          name: 'ingress',
          subnetType: ec2.SubnetType.PUBLIC,
          cidrMask: 24,
        },
        {
          name: 'application',
          subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
          cidrMask: 24,
        },
        {
          name: 'database',
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
          cidrMask: 24,
        },
      ],
    });

    const benchmarkService = new BenchmarkService(this, 'BenchmarkService', {
      vpc,
      dbVpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      dbEngineVersion: props.dbEngineVersion ?? rds.AuroraPostgresEngineVersion.VER_12_8,
      dbInstanceType: props.dbInstanceType,
      dbMultiAz: props.dbMultiAz,
      dbStorageType: props.dbStorageType,
      dbIops: props.dbIops,
      dbParameters: props.dbParameters,
      computeInstanceType: props.computeInstanceType,
      computeMinSize: props.computeAutoscalerMinCapacity,
      computeMaxSize: props.computeAutoscalerMaxCapacity,
      computeDesiredCapacity: props.computeAutoscalerDesiredCapacity,
      computeUseSpot: props.computeUseSpot,
      computeTags: props.computeAutoscalerTags,
      pgBenchScaleFactor: 10000,
      pgBenchFillFactor: 90,
      pgBenchConnections: 50,
      pgBenchThreads: 24,
      pgBenchTime: 600,
      pgBenchSql: 'custom_transaction.sql',
    });

    new CfnOutput(this, 'LogGroupArn', {
      value: benchmarkService.logGroupArn,
    });
    new CfnOutput(this, 'LogGroupName', {
      value: benchmarkService.logGroupName,
    });
    if (benchmarkService.asgName) {
      new CfnOutput(this, 'AsgName', {
        value: benchmarkService.asgName,
      });
    }
    new CfnOutput(this, 'DBWriterEndpoint', {
      value: benchmarkService.dbWriterEndpointAddress,
    });
    new CfnOutput(this, 'DBWriterPort', {
      value: Token.asString(benchmarkService.dbWriterPort),
    });
    if (benchmarkService.dbReaderEndpointAddress) {
      new CfnOutput(this, 'DBReaderEndpoint', {
        value: benchmarkService.dbReaderEndpointAddress,
      });
    }
    if (benchmarkService.dbReaderPort) {
      new CfnOutput(this, 'DBReaderPort', {
        value: Token.asString(benchmarkService.dbReaderPort),
      });
    }
    new CfnOutput(this, 'DBDatabaseName', {
      value: benchmarkService.databaseName,
    });
    new CfnOutput(this, 'DBUsername', {
      value: benchmarkService.username,
    });
    if (benchmarkService.dbSecretName) {
      new CfnOutput(this, 'DBSecretId', {
        value: benchmarkService.dbSecretName,
      });
    }
    if (benchmarkService.pgInitDocument) {
      new CfnOutput(this, 'PgbenchInit', {
        value: benchmarkService.pgInitDocument,
      });
    }
    if (benchmarkService.pgbenchTxDocument) {
      new CfnOutput(this, 'PgbenchTx', {
        value: benchmarkService.pgbenchTxDocument,
      });
    }
    if (benchmarkService.pgBenchCustomTxDocument) {
      new CfnOutput(this, 'CustomTx', {
        value: benchmarkService.pgBenchCustomTxDocument,
      });
    }
    if (benchmarkService.ssmStartSession) {
      new CfnOutput(this, 'SsmStartSession', {
        value: benchmarkService.ssmStartSession,
      });
    }
  }
}

const env = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION,
};

const app = new App();

new BenchmarkDbStack(app, 'aurora-benchmark-stack', {
  env,
  dbEngineVersion: rds.AuroraPostgresEngineVersion.VER_13_3,
  dbInstanceType: ec2.InstanceType.of(ec2.InstanceClass.R6G, ec2.InstanceSize.XLARGE8),
  // dbStorageType: rds.StorageType.IO1,
  // dbIops: 40000,
  dbParameters: {
    'log_min_duration_statement': '30000',
    'max_logical_replication_workers': '32',
    'max_parallel_maintenance_workers': '2',
    'max_replication_slots': '100',
    'max_standby_streaming_delay': '30000',
    'max_worker_processes': '32',
    'rds.logical_replication': '1',
    'wal_sender_timeout': '0',
  },
  computeInstanceType: ec2.InstanceType.of(ec2.InstanceClass.C5, ec2.InstanceSize.XLARGE9),
  computeAutoscalerMaxCapacity: 1,
  // computeAutoscalerDesiredCapacity: 1,
  computeUseSpot: true,
  computeAutoscalerTags: {
    benchmark: 'transaction_group',
  },
});

app.synth();