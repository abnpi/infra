import * as aws from '@pulumi/aws';
import * as awsx from '@pulumi/awsx';
import * as pulumi from '@pulumi/pulumi';
import * as dotenv from 'dotenv';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env') });

// ---------------------------------------------------------------------------
// Configuration (from .env with sensible defaults)
// ---------------------------------------------------------------------------
const awsRegion = process.env.AWS_REGION ?? 'eu-west-1';
const vpcCidr = process.env.VPC_CIDR ?? '10.27.0.0/16';
const dbUsername = process.env.DB_USERNAME ?? 'settle_admin';
const dbPassword = process.env.DB_PASSWORD ?? 'CHANGE_ME_IN_PRODUCTION';
const dbName = process.env.DB_NAME ?? 'settle_db';
const dbInstanceClass = process.env.DB_INSTANCE_CLASS ?? 'db.t4g.micro';
const dbAllocatedStorage = parseInt(process.env.DB_ALLOCATED_STORAGE ?? '20', 10);
const incomingBucketArn = process.env.INCOMING_SETTLEMENT_DATA_ARN ?? '';
const normalizedBucketArn = process.env.NORMALIZED_SETTLEMENT_DATA_ARN ?? '';

const provider = new aws.Provider('settle-provider', { region: awsRegion as aws.Region });
const opts: pulumi.ResourceOptions = { provider };

// ---------------------------------------------------------------------------
// VPC — 2 public subnets, 2 private subnets, NO NAT Gateway
// ---------------------------------------------------------------------------
const vpc = new awsx.ec2.Vpc(
    'settle-vpc',
    {
        cidrBlock: vpcCidr,
        numberOfAvailabilityZones: 2,
        subnetStrategy: 'Auto',
        subnetSpecs: [
            { type: awsx.ec2.SubnetType.Public, cidrMask: 24, name: 'public' },
            { type: awsx.ec2.SubnetType.Private, cidrMask: 24, name: 'private' },
        ],
        natGateways: { strategy: awsx.ec2.NatGatewayStrategy.None },
        enableDnsSupport: true,
        enableDnsHostnames: true,
        tags: { Name: 'settle-vpc', Project: 'settle' },
    },
    opts
);

// ---------------------------------------------------------------------------
// S3 Gateway VPC Endpoint — free path to S3 from private subnets
// ---------------------------------------------------------------------------
const _s3Endpoint = new aws.ec2.VpcEndpoint(
    'settle-s3-endpoint',
    {
        vpcId: vpc.vpcId,
        serviceName: `com.amazonaws.${awsRegion}.s3`,
        vpcEndpointType: 'Gateway',
        routeTableIds: vpc.routeTables.apply((tables) => pulumi.all(tables.map((rt) => rt.id))),
        tags: { Name: 'settle-s3-endpoint', Project: 'settle' },
    },
    opts
);

// ---------------------------------------------------------------------------
// Security Groups
// ---------------------------------------------------------------------------

// Bastion SG — NO inbound, all egress
const bastionSg = new aws.ec2.SecurityGroup(
    'settle-bastion-sg',
    {
        vpcId: vpc.vpcId,
        description: 'Bastion host - SSM only, no inbound',
        egress: [
            {
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound',
            },
        ],
        tags: { Name: 'settle-bastion-sg', Project: 'settle' },
    },
    opts
);

// RDS SG — port 5432 from Bastion SG (seed Lambda rule added in Unit 2)
const rdsSg = new aws.ec2.SecurityGroup(
    'settle-rds-sg',
    {
        vpcId: vpc.vpcId,
        description: 'RDS PostgreSQL - inbound 5432 from Bastion',
        ingress: [
            {
                protocol: 'tcp',
                fromPort: 5432,
                toPort: 5432,
                securityGroups: [bastionSg.id],
                description: 'PostgreSQL from Bastion',
            },
        ],
        egress: [
            {
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'Allow all outbound',
            },
        ],
        tags: { Name: 'settle-rds-sg', Project: 'settle' },
    },
    opts
);

// ---------------------------------------------------------------------------
// RDS PostgreSQL
// ---------------------------------------------------------------------------
const dbSubnetGroup = new aws.rds.SubnetGroup(
    'settle-db-subnet-group',
    {
        subnetIds: vpc.privateSubnetIds,
        tags: { Name: 'settle-db-subnet-group', Project: 'settle' },
    },
    opts
);

// IAM role for RDS to access S3 (aws_s3 extension)
const rdsS3AssumeRole = aws.iam.getPolicyDocumentOutput({
    statements: [
        {
            actions: ['sts:AssumeRole'],
            principals: [
                {
                    type: 'Service',
                    identifiers: ['rds.amazonaws.com'],
                },
            ],
        },
    ],
});

const rdsS3Role = new aws.iam.Role(
    'settle-rds-s3-role',
    {
        assumeRolePolicy: rdsS3AssumeRole.json,
        tags: { Name: 'settle-rds-s3-role', Project: 'settle' },
    },
    opts
);

const _rdsS3Policy = new aws.iam.RolePolicy(
    'settle-rds-s3-policy',
    {
        role: rdsS3Role.id,
        policy: pulumi.jsonStringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Action: ['s3:GetObject'],
                    Resource: [`${incomingBucketArn}/*`, `${normalizedBucketArn}/*`],
                },
            ],
        }),
    },
    opts
);

const dbInstance = new aws.rds.Instance(
    'settle-db',
    {
        engine: 'postgres',
        engineVersion: '16.6',
        instanceClass: dbInstanceClass,
        allocatedStorage: dbAllocatedStorage,
        storageType: 'gp2',
        dbName: dbName,
        username: dbUsername,
        password: dbPassword,
        multiAz: false,
        publiclyAccessible: false,
        dbSubnetGroupName: dbSubnetGroup.name,
        vpcSecurityGroupIds: [rdsSg.id],
        skipFinalSnapshot: true,
        applyImmediately: true,
        tags: { Name: 'settle-db', Project: 'settle' },
    },
    opts
);

const _rdsRoleAssociation = new aws.rds.RoleAssociation(
    'settle-rds-s3-assoc',
    {
        dbInstanceIdentifier: dbInstance.identifier,
        featureName: 's3Import',
        roleArn: rdsS3Role.arn,
    },
    opts
);

// ---------------------------------------------------------------------------
// Bastion Host (SSM — no SSH)
// ---------------------------------------------------------------------------
const bastionAmi = aws.ec2.getAmiOutput(
    {
        mostRecent: true,
        owners: ['amazon'],
        filters: [
            { name: 'name', values: ['al2023-ami-2023.*-x86_64'] }, // <-- Updated filter restricts to standard AMIs
            { name: 'state', values: ['available'] },
            { name: 'virtualization-type', values: ['hvm'] },
        ],
    },
    opts
);

// IAM role for SSM
const bastionAssumeRole = aws.iam.getPolicyDocumentOutput({
    statements: [
        {
            actions: ['sts:AssumeRole'],
            principals: [
                {
                    type: 'Service',
                    identifiers: ['ec2.amazonaws.com'],
                },
            ],
        },
    ],
});

const bastionRole = new aws.iam.Role(
    'settle-bastion-role',
    {
        assumeRolePolicy: bastionAssumeRole.json,
        tags: { Name: 'settle-bastion-role', Project: 'settle' },
    },
    opts
);

const _bastionSsmAttachment = new aws.iam.RolePolicyAttachment(
    'settle-bastion-ssm',
    {
        role: bastionRole.name,
        policyArn: 'arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore',
    },
    opts
);

// dependsOn ensures the policy is fully attached before the instance profile
// is created, avoiding the IAM race condition where the SSM agent boots before
// it has the credentials needed to register with Systems Manager.
const bastionInstanceProfile = new aws.iam.InstanceProfile(
    'settle-bastion-profile',
    {
        role: bastionRole.name,
        tags: { Name: 'settle-bastion-profile', Project: 'settle' },
    },
    { ...opts, dependsOn: [_bastionSsmAttachment] }
);

const bastion = new aws.ec2.Instance(
    'settle-bastion',
    {
        ami: bastionAmi.id,
        instanceType: 't3.micro',
        subnetId: vpc.publicSubnetIds.apply((ids) => ids[0]!),
        vpcSecurityGroupIds: [bastionSg.id],
        iamInstanceProfile: bastionInstanceProfile.name,
        associatePublicIpAddress: true,
        tags: { Name: 'settle-bastion', Project: 'settle' },
        userData: `#!/bin/bash
        systemctl enable amazon-ssm-agent
        systemctl restart amazon-ssm-agent
        sleep 10
        cat /var/log/amazon/ssm/amazon-ssm-agent.log > /dev/console
        `,
    },
    opts
);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const vpcId = vpc.vpcId;
export const privateSubnetIds = vpc.privateSubnetIds;
export const publicSubnetIds = vpc.publicSubnetIds;
export const bastionInstanceId = bastion.id;
export const dbEndpoint = dbInstance.endpoint;
export const dbConnectionString = pulumi.interpolate`postgresql://${dbUsername}:${dbPassword}@${dbInstance.endpoint}/${dbName}?sslmode=require`;
export const dbSecurityGroupId = rdsSg.id;
export const rdsInstanceIdentifier = dbInstance.identifier;
