import * as dotenv from "dotenv";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import { resolve } from "path";

dotenv.config({ path: resolve(__dirname, "../.env") });

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const awsRegion = process.env.AWS_REGION ?? "eu-west-1";
const incomingBucketArn = process.env.INCOMING_SETTLEMENT_DATA_ARN ?? "";
const normalizedBucketArn = process.env.NORMALIZED_SETTLEMENT_DATA_ARN ?? "";
const transformLambdaCodePath = process.env.TRANSFORM_LAMBDA_CODE_PATH
    ?? resolve(__dirname, "../../../dist/apps/settle-transform-lambda");

const provider = new aws.Provider("settle-transform-provider", { region: awsRegion as aws.Region });
const opts: pulumi.ResourceOptions = { provider };

// Derive bucket names from ARNs for notification config
const incomingBucketName = incomingBucketArn.split(":::")[1] ?? "";

// ---------------------------------------------------------------------------
// IAM Role for Lambda
// ---------------------------------------------------------------------------
const lambdaAssumeRole = aws.iam.getPolicyDocumentOutput({
    statements: [{
        actions: ["sts:AssumeRole"],
        principals: [{
            type: "Service",
            identifiers: ["lambda.amazonaws.com"],
        }],
    }],
});

const lambdaRole = new aws.iam.Role("settle-transform-lambda-role", {
    assumeRolePolicy: lambdaAssumeRole.json,
    tags: { Name: "settle-transform-lambda-role", Project: "settle" },
}, opts);

// Basic execution role (CloudWatch Logs)
const _basicExecAttachment = new aws.iam.RolePolicyAttachment("settle-transform-basic-exec", {
    role: lambdaRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
}, opts);

// S3 permissions: GetObject on incoming, PutObject + AbortMultipartUpload on normalized
const _s3Policy = new aws.iam.RolePolicy("settle-transform-s3-policy", {
    role: lambdaRole.id,
    policy: pulumi.jsonStringify({
        Version: "2012-10-17",
        Statement: [
            {
                Effect: "Allow",
                Action: ["s3:GetObject"],
                Resource: [`${incomingBucketArn}/*`],
            },
            {
                Effect: "Allow",
                Action: ["s3:PutObject", "s3:AbortMultipartUpload"],
                Resource: [`${normalizedBucketArn}/*`],
            },
        ],
    }),
}, opts);

// ---------------------------------------------------------------------------
// Lambda Function — NOT in VPC
// ---------------------------------------------------------------------------
const transformLambda = new aws.lambda.Function("settle-transform-lambda", {
    runtime: aws.lambda.Runtime.NodeJS20dX,
    handler: "lambda.handler",
    role: lambdaRole.arn,
    code: new pulumi.asset.FileArchive(transformLambdaCodePath),
    timeout: 120,
    memorySize: 256,
    environment: {
        variables: {
            NODE_ENV: "production",
            INCOMING_SETTLEMENT_DATA_ARN: incomingBucketArn,
            NORMALIZED_SETTLEMENT_DATA_ARN: normalizedBucketArn,
        },
    },
    tags: { Name: "settle-transform-lambda", Project: "settle" },
}, opts);

// ---------------------------------------------------------------------------
// S3 Bucket Notification — trigger on s3:ObjectCreated:*
// ---------------------------------------------------------------------------

// Allow S3 to invoke the Lambda
const _s3Permission = new aws.lambda.Permission("settle-transform-s3-permission", {
    action: "lambda:InvokeFunction",
    function: transformLambda.name,
    principal: "s3.amazonaws.com",
    sourceArn: incomingBucketArn,
}, opts);

// Reference the existing incoming bucket
const incomingBucket = aws.s3.BucketV2.get(
    "settle-incoming-bucket",
    incomingBucketName,
    {},
    opts,
);

const _bucketNotification = new aws.s3.BucketNotification("settle-transform-s3-notification", {
    bucket: incomingBucket.id,
    lambdaFunctions: [{
        lambdaFunctionArn: transformLambda.arn,
        events: ["s3:ObjectCreated:*"],
    }],
}, { ...opts, dependsOn: [_s3Permission] });

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
export const transformLambdaArn = transformLambda.arn;
export const transformLambdaName = transformLambda.name;
