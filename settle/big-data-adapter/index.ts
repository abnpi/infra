import * as pulumi from '@pulumi/pulumi';
import * as aws from '@pulumi/aws';

const config = new pulumi.Config();
const region = aws.config.region;

// 1. Storage: Raw zone for incoming CSVs, Clean for Parquet
const rawBucket = new aws.s3.Bucket('settlement-raw-zone');
const cleanBucket = new aws.s3.Bucket('settlement-clean-zone');

// 2. IAM: Role for the Lambda to read/write S3 and log to CloudWatch
const lambdaRole = new aws.iam.Role('adapter-role', {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({ Service: 'lambda.amazonaws.com' }),
});

new aws.iam.RolePolicy('adapter-policy', {
    role: lambdaRole.id,
    policy: pulumi.all([rawBucket.arn, cleanBucket.arn]).apply(([rawArn, cleanArn]) =>
        JSON.stringify({
            Version: '2012-10-17',
            Statement: [
                {
                    Effect: 'Allow',
                    Action: ['s3:GetObject', 's3:ListBucket'],
                    Resource: [rawArn, `${rawArn}/*`],
                },
                { Effect: 'Allow', Action: ['s3:PutObject'], Resource: [`${cleanArn}/*`] },
                {
                    Effect: 'Allow',
                    Action: ['logs:CreateLogGroup', 'logs:CreateLogStream', 'logs:PutLogEvents'],
                    Resource: 'arn:aws:logs:*:*:*',
                },
            ],
        })
    ),
});

// 3. The Lambda: Using the AWS Data Wrangler Layer (AWS SDK for Pandas)
// Note: Check the AWS docs for the specific ARN in your region.
// Example for us-east-1, Python 3.11, x86_64:
const pandasLayerArn = `arn:aws:lambda:${region}:336392948345:layer:AWSSDKPandas-Python311:12`;

const adapterLambda = new aws.lambda.Function('settlement-adapter', {
    role: lambdaRole.arn,
    runtime: 'python3.11',
    handler: 'index.handler',
    memorySize: 3008, // Enough to handle ~1-2GB CSVs in-memory chunks
    timeout: 900, // Max 15 mins for heavy files
    layers: [pandasLayerArn],
    code: new pulumi.asset.AssetArchive({
        'index.py': new pulumi.asset.FileAsset('./adapter.py'),
    }),
    environment: {
        variables: {
            CLEAN_BUCKET: cleanBucket.bucket,
        },
    },
});

// 4. Trigger: Invoke Lambda when a .csv file is uploaded
new aws.s3.BucketNotification(
    'raw-arrival',
    {
        bucket: rawBucket.id,
        lambdaFunctions: [
            {
                lambdaFunctionArn: adapterLambda.arn,
                events: ['s3:ObjectCreated:*'],
                filterSuffix: '.csv',
            },
        ],
    },
    { dependsOn: [adapterLambda] }
);

// Permission for S3 to call Lambda
new aws.lambda.Permission('s3-trigger-permission', {
    action: 'lambda:InvokeFunction',
    function: adapterLambda.name,
    principal: 's3.amazonaws.com',
    sourceArn: rawBucket.arn,
});

// The Analytics Engine (Your "Reduce" phase)
const settlementDb = new aws.athena.Database('settlements_db', {
    name: 'settlements',
    bucket: cleanBucket.bucket, // Athena stores query results here
});

export const rawBucketName = rawBucket.bucket;
export const cleanBucketName = cleanBucket.bucket;
