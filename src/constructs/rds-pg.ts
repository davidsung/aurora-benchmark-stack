import { RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { Autoscaler } from './autoscaler';

const DEFAULT_RDS_ENGINE_VERSION = rds.PostgresEngineVersion.VER_12_8;
const DEFAULT_USER_NAME = 'benchmark';
const DEFAULT_DATABASE_NAME = 'postgres';
const DEFAULT_INSTANCE_TYPE = ec2.InstanceType.of(
  ec2.InstanceClass.R6G,
  ec2.InstanceSize.XLARGE16,
);
const DEFAULT_CREATE_REPLICA = true;
const DEFAULT_SHOULD_TAKE_SNAPSHOT_BEFORE_DESTROY = false;

export interface RdsPostgresInstanceProps {
  readonly vpc: ec2.IVpc;
  readonly vpcSubnets?: ec2.SubnetSelection;
  readonly engineVersion?: rds.PostgresEngineVersion;
  readonly instanceType?: ec2.InstanceType;
  readonly performanceInsightEncryptionKey?: kms.IKey;
  readonly storageEncryptionKey?: kms.IKey;
  readonly multiAz?: boolean;
  readonly storageType?: rds.StorageType;
  readonly iops?: number;
  readonly allocatedStorage?: number;
  readonly username?: string;
  readonly databaseName?: string;
  readonly parameters?: { [key: string]: string };
  readonly snapshotBeforeDestroy?: boolean;
  readonly createReplica?: boolean;
  readonly autoscaler?: Autoscaler;
}

export class RdsPostgresInstance extends Construct implements ec2.IConnectable {
  public readonly dbWriterEndpointAddress: string;
  public readonly dbWriterPort: number;
  public readonly dbWriterInstanceIdentifier: string;
  public readonly dbReaderInstanceEndpointAddress?: string;
  public readonly dbReaderPort?: number;
  public readonly secret?: secretsmanager.ISecret;
  public readonly connections: ec2.Connections;
  public readonly username: string;
  public readonly databaseName: string;

  // private readonly parameterGroup: rds.IParameterGroup;
  private readonly _rdsPostgres: rds.DatabaseInstance;
  private readonly _rdsPostgresReplica?: rds.DatabaseInstanceReadReplica;
  private readonly instanceType: ec2.InstanceType;
  private readonly multiAz: boolean;
  private readonly snapshotBeforeDestroy: boolean;
  private readonly createReplica: boolean;

  constructor(scope: Construct, id: string, props: RdsPostgresInstanceProps) {
    super(scope, id);

    // RDS PostgreSQL Instance
    const rdsPostgresEngine = rds.DatabaseInstanceEngine.postgres({
      version: props.engineVersion ?? DEFAULT_RDS_ENGINE_VERSION,
    });

    this.instanceType = props.instanceType ?? DEFAULT_INSTANCE_TYPE;
    this.multiAz = props.multiAz ?? true;
    this.createReplica = props.createReplica ?? DEFAULT_CREATE_REPLICA;
    this.username = props.username ?? DEFAULT_USER_NAME;
    this.databaseName = props.databaseName ?? DEFAULT_DATABASE_NAME;
    this.snapshotBeforeDestroy = props.snapshotBeforeDestroy ?? DEFAULT_SHOULD_TAKE_SNAPSHOT_BEFORE_DESTROY;

    // Create RDS PostgreSQL Database MultiAZ Instance
    this._rdsPostgres = new rds.DatabaseInstance(this, 'DatabaseInstance', {
      vpc: props.vpc,
      vpcSubnets: props.vpcSubnets,
      engine: rdsPostgresEngine,
      instanceType: this.instanceType,
      multiAz: this.multiAz,
      credentials: rds.Credentials.fromGeneratedSecret(this.username),
      publiclyAccessible: false,
      // parameterGroup: this.parameterGroup,
      parameters: props.parameters,
      storageEncryptionKey: props.storageEncryptionKey,
      iops: props.iops,
      storageType: props.storageType,
      allocatedStorage: props.allocatedStorage,
      enablePerformanceInsights: true,
      performanceInsightEncryptionKey: props.performanceInsightEncryptionKey,
      databaseName: this.databaseName,
      removalPolicy: this.snapshotBeforeDestroy ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    });

    this.dbWriterEndpointAddress = this._rdsPostgres.dbInstanceEndpointAddress;
    this.dbWriterPort = Number(this._rdsPostgres.dbInstanceEndpointPort);
    this.secret = this._rdsPostgres.secret;
    this.connections = this._rdsPostgres.connections;
    this.dbWriterInstanceIdentifier = this._rdsPostgres.instanceIdentifier;

    // Allow postgresql port from benchmark instance
    if (props.autoscaler) {
      this._rdsPostgres.connections.allowDefaultPortFrom(props.autoscaler);
      this._rdsPostgres.secret?.grantRead(props.autoscaler);
    }

    if (this.createReplica) {
      this._rdsPostgresReplica = new rds.DatabaseInstanceReadReplica(this, 'DatabaseInstanceReplica', {
        sourceDatabaseInstance: this._rdsPostgres,
        vpc: props.vpc,
        instanceType: props.instanceType ?? ec2.InstanceType.of(
          ec2.InstanceClass.R6G,
          ec2.InstanceSize.XLARGE16,
        ),
      });
      this.dbReaderInstanceEndpointAddress = this._rdsPostgresReplica.dbInstanceEndpointAddress;
      this.dbReaderPort = Number(this._rdsPostgresReplica.dbInstanceEndpointPort);
      if (props.autoscaler) {
        this._rdsPostgresReplica.connections.allowDefaultPortFrom(props.autoscaler);
      }
    }
  }

  public grantAccess(autoscaler: Autoscaler) {
    this._rdsPostgres.connections.allowDefaultPortFrom(autoscaler);
    this._rdsPostgres.secret?.grantRead(autoscaler);

    if (this._rdsPostgresReplica) {this._rdsPostgresReplica.connections.allowDefaultPortFrom(autoscaler);}
  }
}