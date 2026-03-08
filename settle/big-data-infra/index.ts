import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

const config = new pulumi.Config();

const region = process.env.AWS_REGION ?? "eu-west-1";

// 1. Storage: Raw zone for incoming CSVs, Clean for Parquet & Outputs
const rawBucket = new aws.s3.Bucket("settlement-raw-zone");
const cleanBucket = new aws.s3.Bucket("settlement-clean-zone");

// 2. IAM: Role for the Lambda to read/write S3 and log to CloudWatch
const lambdaRole = new aws.iam.Role("adapter-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
});

new aws.iam.RolePolicy("adapter-policy", {
  role: lambdaRole.id,
  policy: pulumi
    .all([rawBucket.arn, cleanBucket.arn])
    .apply(([rawArn, cleanArn]) =>
      JSON.stringify({
        Version: "2012-10-17",
        Statement: [
          {
            Effect: "Allow",
            Action: ["s3:GetObject", "s3:ListBucket"],
            Resource: [rawArn, `${rawArn}/*`],
          },
          {
            Effect: "Allow",
            Action: ["s3:PutObject"],
            Resource: [`${cleanArn}/*`],
          },
          {
            Effect: "Allow",
            Action: [
              "logs:CreateLogGroup",
              "logs:CreateLogStream",
              "logs:PutLogEvents",
            ],
            Resource: "arn:aws:logs:*:*:*",
          },
        ],
      }),
    ),
});

// 3. The Lambda: Using the AWS Data Wrangler Layer (AWS SDK for Pandas)
const pandasLayerArn = `arn:aws:lambda:${region}:336392948345:layer:AWSSDKPandas-Python311:12`;

const adyenAdapterLambda = new aws.lambda.Function("adyen-adapter", {
  role: lambdaRole.arn,
  runtime: "python3.11",
  handler: "index.handler",
  memorySize: 3008,
  timeout: 900,
  layers: [pandasLayerArn],
  code: new pulumi.asset.AssetArchive({
    "index.py": new pulumi.asset.FileAsset("./adapters/adyen/index.py"),
  }),
  environment: {
    variables: {
      CLEAN_BUCKET: cleanBucket.bucket,
    },
  },
});

// 4. Trigger: Invoke Lambda when a .csv file is uploaded
new aws.s3.BucketNotification(
  "raw-arrival",
  {
    bucket: rawBucket.id,
    lambdaFunctions: [
      {
        lambdaFunctionArn: adyenAdapterLambda.arn,
        events: ["s3:ObjectCreated:*"],
        filterPrefix: "acquirer=adyen/",
        filterSuffix: ".csv",
      },
    ],
  },
  { dependsOn: [adyenAdapterLambda] },
);

new aws.lambda.Permission("s3-adyen-trigger-permission", {
  action: "lambda:InvokeFunction",
  function: adyenAdapterLambda.name,
  principal: "s3.amazonaws.com",
  sourceArn: rawBucket.arn,
});

// 5. Analytics Engine: Unified Glue table over all acquirers.
//    The normalised Parquet written by every adapter shares the same schema.
//    `acquirer` is a Hive partition column — Athena pushes it down automatically
//    so queries only scan the relevant prefix when filtering by acquirer.
const settlementDb = new aws.athena.Database("settlements_db", {
  name: "settlements",
  bucket: cleanBucket.bucket,
});

const cleanZoneTable = new aws.glue.CatalogTable("clean-zone", {
  databaseName: settlementDb.name,
  name: "clean_zone",
  tableType: "EXTERNAL_TABLE",
  parameters: {
    classification: "parquet",
    "parquet.compression": "SNAPPY",
  },
  partitionKeys: [
    // Hive-style partition: acquirer=adyen/, acquirer=worldpay/, etc.
    { name: "acquirer", type: "string" },
  ],
  storageDescriptor: {
    // Root prefix — Athena resolves per-acquirer sub-prefixes via the partition
    location: pulumi.interpolate`s3://${cleanBucket.bucket}/`,
    inputFormat:
      "org.apache.hadoop.hive.ql.io.parquet.MapredParquetInputFormat",
    outputFormat:
      "org.apache.hadoop.hive.ql.io.parquet.MapredParquetOutputFormat",
    serDeInfo: {
      name: "ParquetHiveSerDe",
      serializationLibrary:
        "org.apache.hadoop.hive.ql.io.parquet.serde.ParquetHiveSerDe",
    },
    columns: [
      { name: "payment_type", type: "string" },
      { name: "type", type: "string" },
      { name: "net_credit", type: "decimal(19,4)" },
      { name: "net_debit", type: "decimal(19,4)" },
    ],
  },
});

// 6. Orchestration: IAM Role for Step Functions to run Athena
const sfnRole = new aws.iam.Role("sfn-athena-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "states.amazonaws.com",
  }),
});

new aws.iam.RolePolicy("sfn-athena-policy", {
  role: sfnRole.id,
  policy: pulumi.all([cleanBucket.arn]).apply(([cleanArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: [
            "athena:StartQueryExecution",
            "athena:GetQueryExecution",
            "athena:GetQueryResults",
            "athena:StopQueryExecution",
          ],
          Resource: "*",
        },
        {
          Effect: "Allow",
          Action: [
            "s3:GetBucketLocation",
            "s3:GetObject",
            "s3:ListBucket",
            "s3:PutObject",
          ],
          Resource: [cleanArn, `${cleanArn}/*`],
        },
        {
          Effect: "Allow",
          Action: ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"],
          Resource: "*",
        },
      ],
    }),
  ),
});

// 7. Orchestration: Aggregation State Machine
//
//    Expected input:  { "acquirer": "adyen" }
//
//    The acquirer value is injected into both the WHERE clause (partition
//    pruning) and the output path via States.Format at runtime, so the same
//    state machine works for every acquirer without redeployment.
const aggregationStateMachine = new aws.sfn.StateMachine(
  "aggregation-sfn",
  {
    roleArn: sfnRole.arn,
    definition: pulumi.all([cleanBucket.bucket]).apply(([bucketName]) =>
      JSON.stringify({
        Comment:
          "Executes Athena aggregation query for a given acquirer and waits for completion",
        StartAt: "RunAthenaAggregation",
        States: {
          RunAthenaAggregation: {
            Type: "Task",
            Resource: "arn:aws:states:::athena:startQueryExecution.sync",
            Parameters: {
              // States.Format injects $.acquirer at runtime
              "QueryString.$":
                "States.Format(\
SELECT \
    acquirer, \
    payment_type, \
    SUM(CASE WHEN type = 'settled'             THEN net_credit ELSE 0 END) AS settled, \
    SUM(CASE WHEN type = 'refunded'            THEN net_debit  ELSE 0 END) AS refunded, \
    SUM(CASE WHEN type = 'chargeback'          THEN net_debit  ELSE 0 END) AS chargebacks, \
    SUM(CASE WHEN type = 'chargeback_reversal' THEN net_credit ELSE 0 END) AS chargeback_reversals \
FROM settlements.clean_zone \
WHERE acquirer = '{}' \
GROUP BY acquirer, payment_type;, $.acquirer)",
              WorkGroup: "primary",
              ResultConfiguration: {
                "OutputLocation.$": `States.Format('s3://${bucketName}/output/aggregates/acquirer={}/', $.acquirer)`,
              },
            },
            End: true,
          },
        },
      }),
    ),
  },
  { dependsOn: [cleanZoneTable] },
);

// 8. Orchestration: Fee Calculation State Machine
//
//    Expected input:  { "acquirer": "adyen" }
const feeStateMachine = new aws.sfn.StateMachine(
  "fees-sfn",
  {
    roleArn: sfnRole.arn,
    definition: pulumi.all([cleanBucket.bucket]).apply(([bucketName]) =>
      JSON.stringify({
        Comment:
          "Executes Athena fee calculation query for a given acquirer and waits for completion",
        StartAt: "RunAthenaFeeCalculation",
        States: {
          RunAthenaFeeCalculation: {
            Type: "Task",
            Resource: "arn:aws:states:::athena:startQueryExecution.sync",
            Parameters: {
              "QueryString.$":
                "States.Format(\
SELECT \
    acquirer, \
    payment_type, \
    SUM(CASE WHEN type = 'settled'  THEN net_credit ELSE 0 END) AS settled, \
    SUM(CASE WHEN type = 'refunded' THEN net_debit  ELSE 0 END) AS refunded, \
    SUM(CASE WHEN type = 'settled' \
        THEN CAST(net_credit * CAST(0.03 AS DECIMAL(18,2)) AS DECIMAL(18,2)) \
        ELSE 0 END) AS fee_on_settled, \
    SUM(CASE WHEN type = 'refunded' \
        THEN CAST(net_debit * CAST(0.03 AS DECIMAL(18,2)) AS DECIMAL(18,2)) \
        ELSE 0 END) AS fee_on_refunded \
FROM settlements.clean_zone \
WHERE acquirer = '{}' \
GROUP BY acquirer, payment_type;, $.acquirer)",
              WorkGroup: "primary",
              ResultConfiguration: {
                "OutputLocation.$": `States.Format('s3://${bucketName}/output/fees/acquirer={}/', $.acquirer)`,
              },
            },
            End: true,
          },
        },
      }),
    ),
  },
  { dependsOn: [cleanZoneTable] },
);

export const rawBucketName = rawBucket.bucket;
export const cleanBucketName = cleanBucket.bucket;
export const stateMachineArn = aggregationStateMachine.arn;
export const feeStateMachineArn = feeStateMachine.arn;
