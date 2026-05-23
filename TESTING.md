# Testing Guide

## Overview

This document describes the test suites created for the Settle infrastructure project.

## Test Files

### 1. Lambda Handler Tests
**File**: `settle/big-data-infra/ingestion-lambda/index.test.ts`

Tests the settlement data ingestion Lambda function that processes CSV files from S3 and writes to the database.

**Test Coverage**:
- ✅ Valid S3 CSV record processing
- ✅ Skipping non-CSV files
- ✅ URL-encoded S3 key handling
- ✅ Skipping rows with zero amounts
- ✅ Empty S3 response handling
- ✅ Missing Body property handling
- ✅ Multiple records in single event
- ✅ Master account lookup
- ✅ Virtual account lookup
- ✅ Transaction creation for settled amounts
- ✅ Fee transaction creation
- ✅ CSV parsing with missing fields
- ✅ CSV parsing with empty lines
- ✅ Large decimal value handling

**Run Tests**:
```bash
cd settle/big-data-infra/ingestion-lambda
bun test index.test.ts
```

### 2. Big Data Infrastructure Tests
**File**: `settle/big-data-infra/index.test.ts`

Tests the Pulumi infrastructure configuration for the big data pipeline including S3, Lambda, Glue, and Step Functions.

**Test Coverage**:
- ✅ Configuration defaults (region, ARNs)
- ✅ Lambda memory and timeout settings
- ✅ Lambda runtime version
- ✅ S3 bucket notification triggers
- ✅ Acquirer-specific filtering
- ✅ Glue table schema validation
- ✅ Parquet format and compression
- ✅ Partition key configuration
- ✅ State machine aggregation query structure
- ✅ State machine fee calculation query
- ✅ States.Format parameter injection
- ✅ S3 output paths
- ✅ IAM permissions (Lambda, Step Functions, Glue)
- ✅ Resource exports
- ✅ Resource dependencies

**Run Tests**:
```bash
cd settle/big-data-infra
bun test index.test.ts
```

### 3. RDS Infrastructure Tests
**File**: `settle/rds-infra/index.test.ts`

Tests the Pulumi infrastructure configuration for the RDS database, VPC, and bastion host.

**Test Coverage**:
- ✅ Configuration defaults (region, CIDR, instance class)
- ✅ VPC CIDR block validation
- ✅ Availability zone count
- ✅ Public and private subnet creation
- ✅ NAT Gateway configuration
- ✅ DNS support settings
- ✅ S3 Gateway VPC Endpoint
- ✅ Bastion security group (no inbound, all outbound)
- ✅ RDS security group (port 5432 from Bastion)
- ✅ PostgreSQL version and engine
- ✅ Storage type and allocation
- ✅ Public accessibility settings
- ✅ Multi-AZ configuration
- ✅ Snapshot handling
- ✅ RDS IAM role for S3 access
- ✅ Bastion host AMI and instance type
- ✅ SSM agent configuration
- ✅ Resource exports
- ✅ Tagging strategy
- ✅ Network architecture
- ✅ Disaster recovery settings

**Run Tests**:
```bash
cd settle/rds-infra
bun test index.test.ts
```

## Running All Tests

From the project root:

```bash
# Run all tests
bun test

# Run tests with verbose output
bun test --verbose

# Run tests with coverage (if supported)
bun test --coverage
```

## Test Framework

Tests use **Bun's built-in test runner** with:
- `describe()` - Test suite grouping
- `it()` - Individual test cases
- `expect()` - Assertions
- `beforeEach()` / `afterEach()` - Setup/teardown
- `mock()` - Function mocking

## Test Patterns

### Configuration Tests
Verify that default values and environment variables are valid:
```typescript
it("should have valid default AWS region", () => {
  const region = process.env.AWS_REGION ?? "eu-west-1";
  expect(region).toMatch(/^[a-z]{2}-[a-z]+-\d+$/);
});
```

### Schema Tests
Validate data structures and configurations:
```typescript
it("should have correct column schema", () => {
  const columns = [...];
  expect(columns.length).toBe(5);
  expect(columns[0].name).toBe("merchant_id");
});
```

### Permission Tests
Ensure IAM policies grant correct permissions:
```typescript
it("should grant Lambda S3 read permissions", () => {
  const actions = ["s3:GetObject", "s3:ListBucket"];
  expect(actions).toContain("s3:GetObject");
});
```

### Handler Tests
Test Lambda function behavior with mocked AWS services:
```typescript
it("should process valid S3 CSV records", async () => {
  mockS3Client.send.mockResolvedValueOnce({
    Body: { transformToString: async () => mockCsvData },
  });
  
  const result = await handler(event);
  expect(result.status).toBe("success");
});
```

## Mocking Strategy

Tests use Bun's `mock()` function to simulate AWS SDK calls:

```typescript
const mockS3Client = {
  send: mock(),
};

// Setup mock return value
mockS3Client.send.mockResolvedValueOnce({
  Body: { transformToString: async () => "csv data" },
});

// Verify mock was called
expect(mockS3Client.send).toHaveBeenCalled();
```

## What's NOT Tested (Integration/E2E)

These tests focus on unit-level validation. The following require integration testing:

- [ ] Actual S3 bucket operations
- [ ] Real database connections
- [ ] Lambda execution in AWS
- [ ] State machine execution
- [ ] Athena query results
- [ ] End-to-end settlement pipeline

## Adding New Tests

When adding new infrastructure or Lambda code:

1. **Create test file** alongside the code:
   ```
   src/
   ├── handler.ts
   └── handler.test.ts
   ```

2. **Follow existing patterns**:
   - Group tests with `describe()`
   - Use descriptive test names
   - Test both happy path and error cases
   - Mock external dependencies

3. **Example**:
   ```typescript
   describe("New Feature", () => {
     it("should do something", () => {
       expect(result).toBe(expected);
     });
   });
   ```

## Continuous Integration

To integrate tests into CI/CD:

```yaml
# Example GitHub Actions workflow
- name: Run Tests
  run: bun test

- name: Check Test Results
  if: failure()
  run: echo "Tests failed"
```

## Troubleshooting

### Tests not running
- Ensure Bun is installed: `bun --version`
- Check file paths are correct
- Verify test files end with `.test.ts`

### Mock not working
- Ensure mock is imported: `import { mock } from "bun:test"`
- Clear mocks between tests: `mockFn.mockClear()`
- Check mock is called before assertion

### Assertion failures
- Use `--verbose` flag for detailed output
- Check expected vs actual values
- Review test data setup

## Future Improvements

- [ ] Add integration tests with LocalStack
- [ ] Add performance benchmarks
- [ ] Add snapshot testing for infrastructure
- [ ] Add property-based testing for data validation
- [ ] Add mutation testing to verify test quality
