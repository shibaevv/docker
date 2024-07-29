import {
  CfnOutput,
  Stack,
  StackProps,
  Tags,
  Duration,
  RemovalPolicy,
} from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { execSync } from 'child_process';

export interface MysqlProps extends StackProps {

  /**
   * VPC
   * @type {ec2.IVpc}
   * @memberof MysqlProps
   */
  readonly vpc: ec2.IVpc;

  /**
   * List of Subnet
   * @type {string[]}
   * @memberof MysqlProps
   */
  readonly vpcSubnets: ec2.SubnetSelection;

  /**
   * provide the name of the database
   * @type {string}
   * @memberof MysqlProps
   * @default elixirdb
   */
  readonly dbName?: string;

  /**
   * ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
   * @type {*}
   * @memberof MysqlProps
   * @default ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.SMALL)
   */
  readonly instanceType?: any;

  /**
   * provide the version of the database
   * @type {*}
   * @memberof MysqlProps
   * @default rds.MysqlEngineVersion.VER_8_0
   */
  readonly engineVersion?: any;

  /**
   * user name of the database
   * @type {string}
   * @memberof MysqlProps
   * @default elixir
   */
  readonly dbUsername?: string;

  /**
   * backup retention days for example 14
   * @type {number}
   * @memberof MysqlProps
   * @default 14
   */
  readonly backupRetentionDays?: number;

  /**
   * Indicates whether the DB instance should have deletion protection enabled.
   * @type {boolean}
   * @memberof MysqlProps
   * @default false
   */
  readonly deletionProtection?: boolean;

  /**
   * backup window time 00:15-01:15
   * @type {string}
   * @memberof MysqlProps
   * @default 00:15-01:15
   */
  readonly backupWindow?: string;

  /**
   * maintenance time Sun:23:45-Mon:00:15
   * @type {string}
   * @memberof MysqlProps
   * @default Sun:23:45-Mon:00:15
   */
  readonly preferredMaintenanceWindow?: string;

  /**
   * list of ingress sources
   * @type {any []}
   * @memberof MysqlProps
   */
  readonly ingressSources?: any[];
}

export class MysqlInstance {

  /**
   * provide the endpoint of the database
   * @type {string}
   * @memberof MysqlInstance
   */
  readonly dbEndpoint: string;

  /**
   * provide the port of the database
   * @type {number}
   * @memberof MysqlInstance
   * @default 3306
   */
  readonly dbPort: number = 3306;

  /**
   * provide the name of the database
   * @type {string}
   * @memberof MysqlInstance
   */
  readonly dbName: string;

  /**
   * provide the credentials of the database
   * @type {rds.Credentials}
   * @memberof MysqlInstance
   */
  readonly dbCredentials: rds.Credentials;

  constructor(stack: Stack, id: string, props: MysqlProps) {
    var ingressSources = [];
    if (typeof props.ingressSources !== 'undefined') {
      ingressSources = props.ingressSources;
    }
    var engineVersion = rds.MysqlEngineVersion.VER_8_0;
    if (typeof props.engineVersion !== 'undefined') {
      engineVersion = props.engineVersion;
    }
    var dbUsername = 'elixir';
    if (typeof props.dbUsername !== 'undefined') {
      dbUsername = props.dbUsername;
    }
    this.dbName = 'elixirdb';
    if (typeof props.dbName !== 'undefined') {
      this.dbName = props.dbName;
    }

    const vpc = props.vpc;

    const tcpMysql = ec2.Port.tcp(this.dbPort);

    const dbsg = new ec2.SecurityGroup(stack, `${id}DatabaseSecurityGroup`, {
      vpc,
      allowAllOutbound: false,
      description: `${id} Database`,
      securityGroupName: `${id}Database`
    });

    // TODO: remove later - developer test only
    // https://apple.stackexchange.com/questions/20547/how-do-i-find-my-ip-address-from-the-command-line
    const developerIpAddress = execSync('dig -4 TXT +short o-o.myaddr.l.google.com @ns1.google.com')
      // remove whitespaces
      .toString().trim()
      // remove both single (‘) and double (“) quotes
      .replace(/['"]+/g, '');
    dbsg.addIngressRule(ec2.Peer.ipv4(`${developerIpAddress}/32`), tcpMysql, 'Developer ONLY !!!');
    // TODO: remove later - developer test only

    dbsg.addIngressRule(ec2.Peer.ipv4(vpc.vpcCidrBlock), tcpMysql, 'Inbound MYSQL');

    dbsg.addEgressRule(ec2.Peer.anyIpv4(), ec2.Port.allTcp(), 'Outbound');

    const mysqlConnectionPorts = [
      { port: tcpMysql, description: `${id} tcp Mysql` }
    ];

    for (let ingressSource of ingressSources!) {
      for (let c of mysqlConnectionPorts) {
        dbsg.addIngressRule(ingressSource, c.port, c.description);
      }
    }

    const dbSecret = new secretsmanager.Secret(stack, `${id}Credentials`, {
      secretName: `prod/${id}/mysql/credentials`,
      description: `Mysql ${this.dbName} Database Crendetials`,
      generateSecretString: {
        excludeCharacters: "\"@/\\ '",
        generateStringKey: 'password',
        passwordLength: 30,
        secretStringTemplate: JSON.stringify({username: dbUsername}),
      }
    });

    this.dbCredentials = rds.Credentials.fromSecret(
      dbSecret,
      dbUsername
    );

    const dbParameterGroup = new rds.ParameterGroup(stack, `${id}ParameterGroup`, {
      engine: rds.DatabaseInstanceEngine.mysql({
        version: engineVersion
      })
    });
    dbParameterGroup.addParameter('log_bin_trust_function_creators', '1');

    const dbInstance = new rds.DatabaseInstance(stack, `${id}Database`, {
      port: this.dbPort,
      instanceIdentifier: `${id}db`,
      databaseName: this.dbName,
      credentials: this.dbCredentials,
      engine: rds.DatabaseInstanceEngine.mysql({
        version: engineVersion
      }),
      backupRetention: Duration.days(7),
      allocatedStorage: 20,
      securityGroups: [dbsg],
      allowMajorVersionUpgrade: true,
      autoMinorVersionUpgrade: true,
      instanceType: props.instanceType,
      vpc,
      vpcSubnets: props.vpcSubnets,
      removalPolicy: RemovalPolicy.SNAPSHOT,
      deletionProtection: props.deletionProtection,
      storageEncrypted: true,
      //monitoringInterval: Duration.seconds(60),
      //enablePerformanceInsights: true,
      parameterGroup: dbParameterGroup,
      preferredBackupWindow: props.backupWindow,
      preferredMaintenanceWindow: props.preferredMaintenanceWindow,
      publiclyAccessible: true,
    });

    //dbInstance.addRotationSingleUser();

    // Tags
    Tags.of(dbInstance).add('Name', `${id}Database`, {
      priority: 300
    });

    this.dbEndpoint = dbInstance.dbInstanceEndpointAddress;
    new CfnOutput(stack, `${id}Endpoint`, {
      exportName: `${id}Endpoint`,
      value: this.dbEndpoint
    });

    new CfnOutput(stack, `${id}Username`, {
      exportName: `${id}Username`,
      value: dbUsername
    });

    new CfnOutput(stack, `${id}DbName`, {
      exportName: `${id}DbName`,
      value: this.dbName
    });
  }
}
