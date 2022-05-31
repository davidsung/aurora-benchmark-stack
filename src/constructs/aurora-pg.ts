import { RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';
import { Autoscaler } from './autoscaler';

const DEFAULT_AURORA_ENGINE_VERSION = rds.AuroraPostgresEngineVersion.VER_12_8;
const DEFAULT_USERNAME = 'benchmark';
const DEFAULT_DATABASE_NAME = 'postgres';
const DEFAULT_INSTANCE_TYPE = ec2.InstanceType.of(
  ec2.InstanceClass.T4G,
  ec2.InstanceSize.MEDIUM,
);
const DEFAULT_SHOULD_TAKE_SNAPSHOT_BEFORE_DESTROY = false;

export interface AuroraPostgresClusterProps {
  readonly vpc: ec2.IVpc;
  readonly vpcSubnets?: ec2.SubnetSelection;
  readonly engineVersion?: rds.AuroraPostgresEngineVersion;
  readonly instanceType?: ec2.InstanceType;
  readonly instances?: number;
  readonly performanceInsightEncryptionKey?: kms.IKey;
  readonly storageEncryptionKey?: kms.IKey;
  readonly defaultUsername?: string;
  readonly defaultDatabaseName?: string;
  readonly clusterParameters?: {
    [key: string]: string;
  };
  readonly instanceParameters?: {
    [key: string]: string;
  };
  readonly snapshotBeforeDestroy?: boolean;
  readonly autoscaler?: Autoscaler;
}

export class AuroraPostgresCluster extends Construct implements ec2.IConnectable {
  public readonly clusterIdentifier: string;
  public readonly clusterEndpoint: rds.Endpoint;
  public readonly clusterReadEndpoint?: rds.Endpoint;
  public readonly secret?: secretsmanager.ISecret;
  public readonly connections: ec2.Connections;
  public readonly username: string;
  public readonly databaseName: string;
  public readonly instanceIdentifiers: string[];

  private readonly engine: rds.IClusterEngine;
  private readonly instanceType: ec2.InstanceType;
  private readonly snapshotBeforeDestroy: boolean;
  private readonly _auroraPostgres: rds.DatabaseCluster;

  constructor(scope: Construct, id: string, props: AuroraPostgresClusterProps) {
    super(scope, id);

    // Aurora PostgreSQL Cluster
    this.engine = rds.DatabaseClusterEngine.auroraPostgres({
      version: props.engineVersion ?? DEFAULT_AURORA_ENGINE_VERSION,
    });

    this.instanceType = props.instanceType ?? DEFAULT_INSTANCE_TYPE;
    this.username = props.defaultUsername ?? DEFAULT_USERNAME;
    this.databaseName = props.defaultDatabaseName ?? DEFAULT_DATABASE_NAME;
    this.snapshotBeforeDestroy = props.snapshotBeforeDestroy ?? DEFAULT_SHOULD_TAKE_SNAPSHOT_BEFORE_DESTROY;

    // Create Aurora PostgreSQL Database Cluster
    this._auroraPostgres = new rds.DatabaseCluster(this, 'DatabaseCluster', {
      engine: this.engine,
      instances: props.instances,
      instanceProps: {
        vpc: props.vpc,
        vpcSubnets: props.vpcSubnets,
        instanceType: this.instanceType,
        enablePerformanceInsights: true,
        performanceInsightEncryptionKey: props.performanceInsightEncryptionKey,
        parameters: props.instanceParameters,
      },
      credentials: rds.Credentials.fromGeneratedSecret(this.username),
      parameters: props.clusterParameters,
      storageEncrypted: true,
      storageEncryptionKey: props.storageEncryptionKey,
      defaultDatabaseName: this.databaseName,
      removalPolicy: this.snapshotBeforeDestroy ? RemovalPolicy.SNAPSHOT : RemovalPolicy.DESTROY,
    });
    this.clusterIdentifier = this._auroraPostgres.clusterIdentifier;
    this.clusterEndpoint = this._auroraPostgres.clusterEndpoint;
    if (props.instances == undefined || (props.instances && props.instances > 1)) {
      this.clusterReadEndpoint = this._auroraPostgres.clusterReadEndpoint;
    }
    this.secret = this._auroraPostgres.secret;
    this.connections = this._auroraPostgres.connections;
    this.instanceIdentifiers = this._auroraPostgres.instanceIdentifiers;

    // Allow postgresql port from benchmark instance
    if (props.autoscaler) {
      this.grantAccess(props.autoscaler);
      // this._auroraPostgres.connections.allowDefaultPortFrom(props.autoscaler);
      // this._auroraPostgres.secret?.grantRead(props.autoscaler);
    }
  }

  public grantAccess(autoscaler: Autoscaler) {
    this._auroraPostgres.connections.allowDefaultPortFrom(autoscaler);
    this._auroraPostgres.secret?.grantRead(autoscaler);
  }
}