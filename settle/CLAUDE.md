# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a Pulumi-based infrastructure repository for a settlement data pipeline that processes payment settlement data. The architecture consists of multiple independent Pulumi stacks that work together:

1. **unit1-infra**: Core AWS infrastructure (VPC, RDS PostgreSQL, Bastion host)
2. **big-data-infra**: S3-based data lake with Lambda adapter, Athena, and Step Functions
3. **unit2-seed**: Lambda for database seeding (deployed inside VPC)
4. **unit3-transform**: Lambda for S3-triggered data transformation (not in VPC)

## Key Architecture Patterns

### Multi-Stack Dependencies

The stacks have dependencies managed through Pulumi StackReferences:
- `unit2-seed` and `unit3-transform` reference outputs from `unit1-infra` using `INFRA_STACK_NAME` env var
- Stack outputs are accessed via `new pulumi.StackReference(infraStackName)`

### Network Architecture

**unit1-infra** creates a VPC with:
- 2 public subnets, 2 private subnets across 2 AZs
- **NO NAT Gateway** (cost optimization)
- S3 Gateway VPC Endpoint for free S3 access from private subnets (unit1-infra/index.ts:49-59)
- RDS in private subnets, accessed via bastion or VPC-attached Lambdas

### Big Data Pipeline (big-data-infra)

Architecture for processing settlement CSV files:
1. **Raw Zone**: CSV files land in `settlement-raw-zone` S3 bucket
2. **Adapter Lambda**: Triggered on CSV upload, converts to Parquet with proper decimal precision, writes to clean zone
3. **Clean Zone**: Parquet files stored with partitioning (`acquirer=adyen/`)
4. **Glue Catalog**: External table pointing to Parquet data
5. **Athena Queries**: Executed via Step Functions state machines for aggregations and fee calculations

The adapter (big-data-adapter/adapter.py) uses AWS Data Wrangler to:
- Process CSVs in 100k row chunks to avoid memory issues
- Convert financial amounts to `DECIMAL(19,4)` to prevent floating-point errors
- Partition data for query performance

### Database Access Patterns

**RDS Security**: Multi-layer security group rules:
- Bastion SG allows no inbound, only SSM access (unit1-infra/index.ts:66-83)
- RDS SG allows port 5432 from Bastion SG (unit1-infra/index.ts:86-112)
- Seed Lambda SG added dynamically in unit2-seed (unit2-seed/index.ts:60-72)

**RDS S3 Integration**: RDS has IAM role attached for `s3Import` feature, allowing PostgreSQL to directly query S3 using `aws_s3` extension (unit1-infra/index.ts:127-198)

## Common Commands

### Environment Setup
```bash
# Copy and configure environment variables
cp .env.example .env
# Edit .env with your values
```

### Pulumi Deployment Order

Deploy stacks in dependency order:

```bash
# 1. Core infrastructure (VPC, RDS, Bastion)
cd unit1-infra
pulumi up -s dev

# 2. Big data infrastructure (S3, Lambda, Athena)
cd ../big-data-infra
pulumi up -s settlement-ingest

# 3. Seed Lambda (requires unit1-infra outputs)
cd ../unit2-seed
pulumi up -s dev

# 4. Transform Lambda (requires pre-existing S3 buckets in .env)
cd ../unit3-transform
pulumi up -s dev
```

### Destroying Infrastructure

Destroy in reverse order:
```bash
cd unit3-transform && pulumi destroy -s dev
cd ../unit2-seed && pulumi destroy -s dev
cd ../big-data-infra && pulumi destroy -s settlement-ingest
cd ../unit1-infra && pulumi destroy -s dev
```

### TypeScript Compilation
```bash
# Compile all Pulumi programs
npm run build  # Uses tsc with tsconfig.json
```

### Accessing Bastion Host
```bash
# Get bastion instance ID from Pulumi output
cd unit1-infra
pulumi stack output bastionInstanceId

# Connect via AWS Systems Manager Session Manager (no SSH key needed)
aws ssm start-session --target <bastion-instance-id>
```

### Accessing RDS from Bastion
```bash
# After SSM into bastion:
sudo yum install -y postgresql15

# Get connection string from Pulumi output
cd unit1-infra
pulumi stack output dbConnectionString

# Connect to PostgreSQL
psql "<connection-string>"
```

## Configuration

All stacks use `dotenv` to load configuration from `.env` file at repository root. Key variables:

- `AWS_REGION`: Target AWS region (default: eu-west-1)
- `INFRA_STACK_NAME`: Reference to unit1-infra stack (e.g., "settle-infra/dev")
- `INCOMING_SETTLEMENT_DATA_ARN`: Pre-existing S3 bucket for raw settlement data
- `NORMALIZED_SETTLEMENT_DATA_ARN`: Pre-existing S3 bucket for normalized data
- `SEED_LAMBDA_CODE_PATH`: Path to compiled seed Lambda code
- `TRANSFORM_LAMBDA_CODE_PATH`: Path to compiled transform Lambda code

See `.env.example` for complete configuration reference.

## Important Implementation Details

### Lambda Code Paths
- unit2-seed and unit3-transform expect pre-built Lambda code at paths specified in `.env`
- Default paths reference `../../dist/apps/` which suggests this is part of a monorepo
- Lambda code must be built before running `pulumi up`

### S3 Bucket Notification Dependencies
Both big-data-infra and unit3-transform set up S3 bucket notifications:
- Must create `aws.lambda.Permission` before `aws.s3.BucketNotification`
- Use `dependsOn` to enforce ordering (unit3-transform/index.ts:113)

### IAM Role Attachments with dependsOn
When creating instance profiles or Lambda functions that use IAM roles:
- Always use `dependsOn` to wait for policy attachments to complete
- Prevents race conditions where resources boot before IAM permissions propagate
- Example: Bastion instance profile waits for SSM policy attachment (unit1-infra/index.ts:252-259)

### Financial Precision in Data Pipeline
The adapter Lambda uses `Decimal` types and explicit schema specifications:
- Parse amounts as strings first, then convert to Decimal
- Specify Parquet schema as `decimal(19,4)` to avoid float conversion
- This pattern is critical for financial calculations (big-data-adapter/adapter.py:26-39)

### Step Functions for Athena Queries
big-data-infra defines two Step Functions state machines:
- `aggregation-sfn`: Aggregates settlement data by merchant
- `fees-sfn`: Calculates 3% fees on settled/refunded transactions
- Both use `.sync` integration to wait for query completion
- Query results automatically written to S3 output locations
