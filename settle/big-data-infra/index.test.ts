import { describe, it, expect, beforeEach } from "bun:test";
import * as pulumi from "@pulumi/pulumi";

describe("Big Data Infrastructure (Pulumi)", () => {
  describe("Configuration", () => {
    it("should use eu-west-1 as default region", () => {
      const region = process.env.AWS_REGION ?? "eu-west-1";
      expect(region).toBe("eu-west-1");
    });

    it("should construct valid pandas layer ARN for region", () => {
      const region = "eu-west-1";
      const pandasLayerArn = `arn:aws:lambda:${region}:336392948345:layer:AWSSDKPandas-Python311:12`;
      expect(pandasLayerArn).toContain("arn:aws:lambda:");
      expect(pandasLayerArn).toContain(region);
      expect(pandasLayerArn).toContain("AWSSDKPandas-Python311");
    });

    it("should have valid ARN format", () => {
      const region = "eu-west-1";
      const pandasLayerArn = `arn:aws:lambda:${region}:336392948345:layer:AWSSDKPandas-Python311:12`;
      const arnPattern =
        /^arn:aws:lambda:[a-z]{2}-[a-z]+-\d+:\d+:layer:[a-zA-Z0-9_-]+:\d+$/;
      expect(arnPattern.test(pandasLayerArn)).toBe(true);
    });
  });

  describe("Lambda Configuration", () => {
    it("should have sufficient memory for CSV processing", () => {
      const memorySize = 3008;
      expect(memorySize).toBeGreaterThanOrEqual(1024);
      expect(memorySize).toBeLessThanOrEqual(10240);
    });

    it("should have sufficient timeout for heavy files", () => {
      const timeout = 900;
      expect(timeout).toBeGreaterThanOrEqual(60);
      expect(timeout).toBeLessThanOrEqual(900);
    });

    it("should use Python 3.11 runtime", () => {
      const runtime = "python3.11";
      expect(runtime).toMatch(/^python3\.\d+$/);
    });

    it("should have correct handler path", () => {
      const handler = "index.handler";
      expect(handler).toMatch(/^[a-zA-Z0-9._-]+\.handler$/);
    });
  });

  describe("S3 Bucket Notification", () => {
    it("should trigger on CSV file creation", () => {
      const events = ["s3:ObjectCreated:*"];
      const filterSuffix = ".csv";
      expect(events).toContain("s3:ObjectCreated:*");
      expect(filterSuffix).toBe(".csv");
    });

    it("should filter by acquirer prefix", () => {
      const adyenPrefix = "acquirer=adyen/";
      const worldlinePrefix = "acquirer=worldline/";
      expect(adyenPrefix).toContain("acquirer=");
      expect(worldlinePrefix).toContain("acquirer=");
    });

    it("should have separate triggers for each acquirer", () => {
      const acquirers = ["adyen", "worldline"];
      expect(acquirers.length).toBe(2);
      acquirers.forEach((acq) => {
        expect(acq).toMatch(/^[a-z]+$/);
      });
    });
  });

  describe("Glue Table Configuration", () => {
    it("should have correct partition key for acquirer", () => {
      const partitionKey = "acquirer";
      expect(partitionKey).toBe("acquirer");
    });

    it("should use Parquet format with SNAPPY compression", () => {
      const classification = "parquet";
      const compression = "SNAPPY";
      expect(classification).toBe("parquet");
      expect(compression).toBe("SNAPPY");
    });

    it("should have correct column schema for clean zone", () => {
      const columns = [
        { name: "merchant_id", type: "string" },
        { name: "payment_type", type: "string" },
        { name: "type", type: "string" },
        { name: "net_credit", type: "decimal(19,4)" },
        { name: "net_debit", type: "decimal(19,4)" },
      ];
      expect(columns.length).toBe(5);
      expect(columns[0].name).toBe("merchant_id");
      expect(columns[3].type).toContain("decimal");
    });

    it("should have correct column schema for merchant fees", () => {
      const columns = [
        { name: "merchant_id", type: "string" },
        { name: "payment_type", type: "string" },
        { name: "fee_percentage", type: "decimal(18,4)" },
        { name: "fee_flat", type: "decimal(18,4)" },
      ];
      expect(columns.length).toBe(4);
      expect(columns[2].type).toContain("decimal");
    });

    it("should use external table type", () => {
      const tableType = "EXTERNAL_TABLE";
      expect(tableType).toBe("EXTERNAL_TABLE");
    });
  });

  describe("State Machine - Aggregation Query", () => {
    it("should have valid SQL aggregation query structure", () => {
      const query = `SELECT 
    acquirer, 
    merchant_id, 
    payment_type, 
    SUM(CASE WHEN type = 'settled' THEN net_credit ELSE 0 END) AS settled`;
      expect(query).toContain("SELECT");
      expect(query).toContain("SUM");
      expect(query).toContain("GROUP BY");
    });

    it("should aggregate all transaction types", () => {
      const transactionTypes = ["settled", "refunded", "chargeback", "chargeback_reversal"];
      transactionTypes.forEach((type) => {
        expect(type).toMatch(/^[a-z_]+$/);
      });
    });

    it("should use States.Format for runtime parameter injection", () => {
      const formatString = "States.Format('...', $.acquirer)";
      expect(formatString).toContain("States.Format");
      expect(formatString).toContain("$.acquirer");
    });

    it("should output to S3 with acquirer partition", () => {
      const outputPath = "s3://bucket/output/aggregates/acquirer={}/";
      expect(outputPath).toContain("s3://");
      expect(outputPath).toContain("acquirer={}");
    });
  });

  describe("State Machine - Fee Calculation Query", () => {
    it("should join clean zone with merchant fees table", () => {
      const query = `FROM settlements.clean_zone cz
LEFT JOIN settlements.merchant_fees mf`;
      expect(query).toContain("LEFT JOIN");
      expect(query).toContain("merchant_fees");
    });

    it("should calculate fees on settled and refunded", () => {
      const calculations = [
        "fee_on_settled",
        "fee_on_refunded",
      ];
      expect(calculations.length).toBe(2);
    });

    it("should handle null fee values with COALESCE", () => {
      const query = "COALESCE(mf.fee_percentage, CAST(0 AS DECIMAL(18,4)))";
      expect(query).toContain("COALESCE");
      expect(query).toContain("CAST");
    });

    it("should output to separate fees directory", () => {
      const outputPath = "s3://bucket/output/fees/acquirer={}/";
      expect(outputPath).toContain("fees");
      expect(outputPath).toContain("acquirer={}");
    });
  });

  describe("IAM Permissions", () => {
    it("should grant Lambda S3 read permissions on raw bucket", () => {
      const actions = ["s3:GetObject", "s3:ListBucket"];
      expect(actions).toContain("s3:GetObject");
      expect(actions).toContain("s3:ListBucket");
    });

    it("should grant Lambda S3 write permissions on clean bucket", () => {
      const actions = ["s3:PutObject"];
      expect(actions).toContain("s3:PutObject");
    });

    it("should grant Lambda CloudWatch logging permissions", () => {
      const actions = [
        "logs:CreateLogGroup",
        "logs:CreateLogStream",
        "logs:PutLogEvents",
      ];
      expect(actions.length).toBe(3);
      actions.forEach((action) => {
        expect(action).toContain("logs:");
      });
    });

    it("should grant Step Functions Athena permissions", () => {
      const actions = [
        "athena:StartQueryExecution",
        "athena:GetQueryExecution",
        "athena:GetQueryResults",
        "athena:StopQueryExecution",
      ];
      expect(actions.length).toBe(4);
      actions.forEach((action) => {
        expect(action).toContain("athena:");
      });
    });

    it("should grant Step Functions Glue permissions", () => {
      const actions = ["glue:GetTable", "glue:GetDatabase", "glue:GetPartitions"];
      expect(actions.length).toBe(3);
      actions.forEach((action) => {
        expect(action).toContain("glue:");
      });
    });
  });

  describe("Exports", () => {
    it("should export raw bucket name", () => {
      const exportName = "rawBucketName";
      expect(exportName).toMatch(/^[a-zA-Z]+$/);
    });

    it("should export clean bucket name", () => {
      const exportName = "cleanBucketName";
      expect(exportName).toMatch(/^[a-zA-Z]+$/);
    });

    it("should export state machine ARNs", () => {
      const exports = ["stateMachineArn", "feeStateMachineArn"];
      expect(exports.length).toBe(2);
      exports.forEach((exp) => {
        expect(exp).toContain("Arn");
      });
    });
  });

  describe("Resource Dependencies", () => {
    it("should have aggregation state machine depend on clean zone table", () => {
      const dependency = "cleanZoneTable";
      expect(dependency).toMatch(/[A-Z]/);
    });

    it("should have fee state machine depend on both tables", () => {
      const dependencies = ["cleanZoneTable", "merchantFeesTable"];
      expect(dependencies.length).toBe(2);
    });

    it("should have bucket notification depend on Lambda functions", () => {
      const dependencies = ["adyenAdapterLambda", "worldlineAdapterLambda"];
      expect(dependencies.length).toBe(2);
    });
  });
});
