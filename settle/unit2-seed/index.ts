import * as dotenv from 'dotenv';
import * as aws from '@pulumi/aws';
import * as pulumi from '@pulumi/pulumi';
import { resolve } from 'path';

dotenv.config({ path: resolve(__dirname, '../.env') });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const awsRegion = process.env.AWS_REGION ?? 'eu-west-1';
const infraStackName = process.env.INFRA_STACK_NAME ?? 'settle-infra/dev';
const seedLambdaCodePath =
    process.env.SEED_LAMBDA_CODE_PATH ??
    resolve(__dirname, '../../../dist/apps/settle-ingest-lambda');

const provider = new aws.Provider('settle-seed-provider', { region: awsRegion as aws.Region });
const opts: pulumi.ResourceOptions = { provider };

// ---------------------------------------------------------------------------
// Stack Reference — read Unit 1 outputs
// ---------------------------------------------------------------------------
const infraStack = new pulumi.StackReference(infraStackName);

const vpcId = infraStack.getOutput('vpcId') as pulumi.Output<string>;
const privateSubnetIds = infraStack.getOutput('privateSubnetIds') as pulumi.Output<string[]>;
const dbSecurityGroupId = infraStack.getOutput('dbSecurityGroupId') as pulumi.Output<string>;
const dbConnectionString = infraStack.getOutput('dbConnectionString') as pulumi.Output<string>;

// ---------------------------------------------------------------------------
// Security Group — Lambda egress to RDS on port 5432
// ---------------------------------------------------------------------------
const lambdaSg = new aws.ec2.SecurityGroup(
    'settle-seed-lambda-sg',
    {
        vpcId,
        description: 'Seed Lambda - egress to RDS 5432',
        egress: [
            {
                protocol: 'tcp',
                fromPort: 5432,
                toPort: 5432,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'PostgreSQL egress',
            },
            {
                protocol: '-1',
                fromPort: 0,
                toPort: 0,
                cidrBlocks: ['0.0.0.0/0'],
                description: 'General egress (DNS, etc.)',
            },
        ],
        tags: { Name: 'settle-seed-lambda-sg', Project: 'settle' },
    },
    opts
);

// Allow inbound 5432 on the RDS SG from this Lambda SG
const _rdsIngressFromLambda = new aws.ec2.SecurityGroupRule(
    'settle-rds-ingress-seed-lambda',
    {
        type: 'ingress',
        fromPort: 5432,
        toPort: 5432,
        protocol: 'tcp',
        securityGroupId: dbSecurityGroupId,
        sourceSecurityGroupId: lambdaSg.id,
        description: 'PostgreSQL from seed Lambda',
    },
    opts
);

// ---------------------------------------------------------------------------
// IAM Role for Lambda
// ---------------------------------------------------------------------------
const lambdaAssumeRole = aws.iam.getPolicyDocumentOutput({
    statements: [
        {
            actions: ['sts:AssumeRole'],
            principals: [
                {
                    type: 'Service',
                    identifiers: ['lambda.amazonaws.com'],
                },
            ],
        },
    ],
});

const lambdaRole = new aws.iam.Role(
    'settle-seed-lambda-role',
    {
        assumeRolePolicy: lambdaAssumeRole.json,
        tags: { Name: 'settle-seed-lambda-role', Project: 'settle' },
    },
    opts
);

const _vpcAccessAttachment = new aws.iam.RolePolicyAttachment(
    'settle-seed-vpc-access',
    {
        role: lambdaRole.name,
        policyArn: 'arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole',
    },
    opts
);

// ---------------------------------------------------------------------------
// Lambda Function
// ---------------------------------------------------------------------------
const seedLambda = new aws.lambda.Function(
    'settle-seed-lambda',
    {
        runtime: aws.lambda.Runtime.NodeJS20dX,
        handler: 'lambda.handler',
        role: lambdaRole.arn,
        code: new pulumi.asset.FileArchive(seedLambdaCodePath),
        timeout: 60,
        memorySize: 256,
        vpcConfig: {
            subnetIds: privateSubnetIds,
            securityGroupIds: [lambdaSg.id],
        },
        environment: {
            variables: {
                NODE_ENV: 'production',
                SETTLE_DATABASE_URL: dbConnectionString,
            },
        },
        tags: { Name: 'settle-seed-lambda', Project: 'settle' },
    },
    opts
);

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const seedLambdaArn = seedLambda.arn;
export const seedLambdaName = seedLambda.name;
export const seedLambdaSecurityGroupId = lambdaSg.id;
