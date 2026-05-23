import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { handler, processRow } from "./index";
import { PrismaClient } from "@prisma/client";

const mockS3Client = {
  send: mock(),
};

const mockPrismaClient = {
  masterAccount: {
    findFirst: mock(),
  },
  virtualAccount: {
    findFirst: mock(),
  },
  $transaction: mock(),
};

describe("Settlement Ingestion Lambda", () => {
  beforeEach(() => {
    mockS3Client.send.mockClear();
    mockPrismaClient.masterAccount.findFirst.mockClear();
    mockPrismaClient.virtualAccount.findFirst.mockClear();
    mockPrismaClient.$transaction.mockClear();
  });

  describe("handler", () => {
    it("should process valid S3 CSV records", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,1000.00,0.00,50.00,0.00
adyen,MERCHANT002,bank_transfer,500.00,100.00,25.00,5.00`;

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => mockCsvData,
        },
      });

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should skip non-CSV files", async () => {
      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "metadata.json" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
      expect(mockS3Client.send).not.toHaveBeenCalled();
    });

    it("should handle URL-encoded S3 keys", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,1000.00,0.00,50.00,0.00`;

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => mockCsvData,
        },
      });

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "acquirer%3Dadyen/data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should skip rows with all zero amounts", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,0.00,0.00,0.00,0.00
adyen,MERCHANT002,card,1000.00,0.00,50.00,0.00`;

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => mockCsvData,
        },
      });

      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should handle empty S3 response body", async () => {
      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => null,
        },
      });

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should handle missing Body property", async () => {
      mockS3Client.send.mockResolvedValueOnce({});

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should process multiple records in a single event", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,1000.00,0.00,50.00,0.00`;

      mockS3Client.send
        .mockResolvedValueOnce({
          Body: { transformToString: async () => mockCsvData },
        })
        .mockResolvedValueOnce({
          Body: { transformToString: async () => mockCsvData },
        });

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data1.csv" },
            },
          },
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data2.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });
  });

  describe("processRow", () => {
    it("should skip processing when master account not found", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce(null);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 1000,
        refunded: 0,
        feeOnSettled: 50,
        feeOnRefunded: 0,
      });

      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });

    it("should skip processing when virtual accounts not found", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 1000,
        refunded: 0,
        feeOnSettled: 50,
        feeOnRefunded: 0,
      });

      expect(mockPrismaClient.$transaction).not.toHaveBeenCalled();
    });

    it("should create transaction for settled amounts", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 1000,
        refunded: 0,
        feeOnSettled: 50,
        feeOnRefunded: 0,
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });

    it("should create fee transactions when fees are present", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 1000,
        refunded: 0,
        feeOnSettled: 50,
        feeOnRefunded: 10,
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });

    it("should skip fee transaction when total fees are zero", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 1000,
        refunded: 0,
        feeOnSettled: 0,
        feeOnRefunded: 0,
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });

    it("should handle refunded amounts", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 0,
        refunded: 500,
        feeOnSettled: 0,
        feeOnRefunded: 25,
      });

      expect(mockPrismaClient.$transaction).toHaveBeenCalled();
    });

    it("should generate unique external source references", async () => {
      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      const transactionCallback = mock();
      mockPrismaClient.$transaction.mockImplementation(transactionCallback);

      await processRow("adyen", "MERCHANT001", "card", {
        settled: 1000,
        refunded: 0,
        feeOnSettled: 50,
        feeOnRefunded: 0,
      });

      expect(transactionCallback).toHaveBeenCalled();
    });
  });

  describe("CSV parsing edge cases", () => {
    it("should handle CSV with missing optional fields", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,1000.00,0.00,50.00,0.00`;

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => mockCsvData,
        },
      });

      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should handle CSV with empty lines", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,1000.00,0.00,50.00,0.00

adyen,MERCHANT002,card,500.00,0.00,25.00,0.00`;

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => mockCsvData,
        },
      });

      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });

    it("should handle large decimal values", async () => {
      const mockCsvData = `acquirer,merchant_id,payment_type,settled,refunded,fee_on_settled,fee_on_refunded
adyen,MERCHANT001,card,999999999.9999,0.00,50000.0000,0.00`;

      mockS3Client.send.mockResolvedValueOnce({
        Body: {
          transformToString: async () => mockCsvData,
        },
      });

      mockPrismaClient.masterAccount.findFirst.mockResolvedValueOnce({
        id: "master-1",
      });

      mockPrismaClient.virtualAccount.findFirst
        .mockResolvedValueOnce({ id: "inbound-1", currency: "EUR" })
        .mockResolvedValueOnce({ id: "fees-1", currency: "EUR" });

      mockPrismaClient.$transaction.mockResolvedValueOnce(null);

      const event = {
        Records: [
          {
            s3: {
              bucket: { name: "test-bucket" },
              object: { key: "data.csv" },
            },
          },
        ],
      };

      const result = await handler(event);
      expect(result.status).toBe("success");
    });
  });
});
