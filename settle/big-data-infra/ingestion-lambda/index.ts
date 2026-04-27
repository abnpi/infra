import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";
import { PrismaClient, TransactionType, AccountType, LedgerEntrySide, TransactionStatus } from "@prisma/client";
import * as csv from "csv-parse/sync";

const s3 = new S3Client({});
const prisma = new PrismaClient();

export const handler = async (event: any) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, " "));

    // Only process .csv from Athena (ignore metadata files)
    if (!key.endsWith(".csv")) continue;

    const response = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const bodyStr = await response.Body?.transformToString();
    if (!bodyStr) continue;

    // Parse Athena CSV output
    const rows = csv.parse(bodyStr, {
      columns: true,
      skip_empty_lines: true,
      cast: true,
    });

    for (const row of rows) {
      const {
        acquirer,
        merchant_id,
        payment_type,
        settled,
        refunded,
        fee_on_settled,
        fee_on_refunded,
      } = row;

      // Skip rows that have zero amounts
      if (
        Number(settled) === 0 &&
        Number(refunded) === 0 &&
        Number(fee_on_settled) === 0 &&
        Number(fee_on_refunded) === 0
      ) {
        continue;
      }

      await processRow(acquirer, merchant_id, payment_type, {
        settled: Number(settled),
        refunded: Number(refunded),
        feeOnSettled: Number(fee_on_settled),
        feeOnRefunded: Number(fee_on_refunded),
      });
    }
  }

  return { status: "success" };
};

async function processRow(
  acquirerId: string,
  merchantId: string,
  paymentType: string,
  amounts: { settled: number; refunded: number; feeOnSettled: number; feeOnRefunded: number }
) {
  // Find or create virtual accounts. In a real system, these are pre-provisioned via MasterAccount.
  // We look up by merchantId and accountType.
  
  // For brevity, we assume the accounts exist or we fetch them.
  // Note: schema uses `VirtualAccount` with `masterAccountId`. We mock this by finding the master account.
  
  const masterAccount = await prisma.masterAccount.findFirst({
    where: { mid: merchantId },
  });

  if (!masterAccount) {
    console.warn(`MasterAccount not found for mid: ${merchantId}`);
    return;
  }

  const inboundAccount = await prisma.virtualAccount.findFirst({
    where: { masterAccountId: masterAccount.id, accountType: AccountType.INBOUND },
  });
  
  const feeAccount = await prisma.virtualAccount.findFirst({
    where: { masterAccountId: masterAccount.id, accountType: AccountType.FEES },
  });

  if (!inboundAccount || !feeAccount) {
    console.warn(`Required virtual accounts missing for merchant ${merchantId}`);
    return;
  }

  // Use Prisma transaction to atomically post entries
  await prisma.$transaction(async (tx) => {
    
    // 1. Inbound Settled (Credit to Inbound Account)
    if (amounts.settled > 0) {
      const transaction = await tx.transaction.create({
        data: {
          externalSourceReference: `SETTLE-${acquirerId}-${merchantId}-${Date.now()}-INBOUND`,
          currency: inboundAccount.currency,
          type: TransactionType.INBOUND_PAYMENT,
          status: TransactionStatus.SUCCESS,
          transactionDate: new Date(),
        },
      });

      await tx.ledgerEntry.create({
        data: {
          accountId: inboundAccount.id,
          transactionId: transaction.id,
          side: LedgerEntrySide.CREDIT,
          amount: amounts.settled,
        },
      });
    }

    // 2. Fee Deductions (Debit from Inbound, Credit to Internal Fees Account)
    const totalFees = amounts.feeOnSettled + amounts.feeOnRefunded;
    if (totalFees > 0) {
      const feeTx = await tx.transaction.create({
        data: {
          externalSourceReference: `SETTLE-${acquirerId}-${merchantId}-${Date.now()}-FEES`,
          currency: feeAccount.currency,
          type: TransactionType.FEE_PAYMENT,
          status: TransactionStatus.SUCCESS,
          transactionDate: new Date(),
        },
      });

      // Debit Inbound
      await tx.ledgerEntry.create({
        data: {
          accountId: inboundAccount.id,
          transactionId: feeTx.id,
          side: LedgerEntrySide.DEBIT,
          amount: totalFees,
        },
      });
      
      // Credit Fees
      await tx.ledgerEntry.create({
        data: {
          accountId: feeAccount.id,
          transactionId: feeTx.id,
          side: LedgerEntrySide.CREDIT,
          amount: totalFees,
        },
      });
    }
  });
}
