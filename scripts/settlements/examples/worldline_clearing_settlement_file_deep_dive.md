# Worldline Acquiring - Clearing / Settlement File Deep Dive

## Your Use Case

You are building a **white-label platform for merchants** with Worldline as the first contracted acquirer. You need to receive and parse the **clearing/settlement file** — the file that tells you exactly how money landed on the safeguarding account: all transactions, refunds, chargebacks, reversals, scheme info, fees, etc.

---

## 1. What File Will You Actually Receive from Worldline?

### The Short Answer

Worldline FS (Financial Services, formerly equensWorldline) does **not** send you raw scheme clearing files (Visa TC33A / Mastercard IPM). Instead, Worldline **processes** those scheme files internally and provides you with **their own proprietary settlement/clearing output** in one of these forms:

| Channel | Format | Description |
|---------|--------|-------------|
| **Data Warehouse Feeds** | Proprietary flat files (CSV/fixed-length) | 3 bulk feeds: **Authorizations**, **Clearing**, **Merchant Payments** — delivered via SFTP |
| **REST APIs** | JSON | Transactions API, Merchant Payments API, Statements API |
| **WX File** (if using Worldline Connect platform) | XML / CSV / ASCII | Daily operational report with all processed orders and collections |
| **Financial Report** (if using Worldline Connect platform) | PDF / CSV / XML UTF8 | Daily report with remittance, collections, and operational overview |
| **Sips Reports** (if using Worldline Direct platform) | CSV | JRB (Financial Reconciliation), JRI (Chargeback Reconciliation), JO (Operations), JT (Transactions) |

### What Matters for Your Platform

For a **white-label platform receiving settlement data from Worldline as acquirer**, you will most likely receive either:

1. **The Clearing Data Warehouse Feed** — a bulk file delivered daily via SFTP containing transaction-level clearing data
2. **The REST APIs** (Transactions + Merchant Payments + Statements) — for real-time/near-real-time access

The exact format and delivery mechanism is **agreed during your onboarding/contracting with Worldline FS**. The detailed file specifications are provided under NDA as part of the integration documentation.

---

## 2. What Data Will the Clearing/Settlement File Contain?

Based on all the Worldline documentation and industry standards, here is the **expected data structure** of what you'll receive. This is reconstructed from Worldline's API field definitions, their Processor Settlements API, and standard acquirer clearing file practices:

### 2.1 File-Level Header

| Field | Description | Example |
|-------|-------------|---------|
| File ID | Unique identifier for the file | `CLR-20260403-001` |
| Acquirer ID | Your acquirer identifier at Worldline | `315000001` |
| File Creation Date/Time | When the file was generated | `2026-04-03T02:00:00Z` |
| Settlement Date | The date this settlement covers | `2026-04-02` |
| Settlement Currency | ISO 4217 currency code | `EUR` |
| Total Debit Count | Number of debit (purchase) transactions | `1,542` |
| Total Credit Count | Number of credit (refund) transactions | `87` |
| Total Debit Amount | Sum of all debits | `245,831.50` |
| Total Credit Amount | Sum of all credits | `12,456.20` |
| Net Settlement Amount | Debit - Credit - Fees | `230,125.30` |
| Total Fee Amount | Total processing fees | `3,250.00` |
| Record Count | Total number of transaction records | `1,680` |

### 2.2 Transaction-Level Records

Each transaction record in the file will contain fields like:

#### Core Transaction Fields

| Field | Description | Example |
|-------|-------------|---------|
| Transaction ID | Unique Worldline transaction identifier | `TXN-20260401-8A4232E3` |
| Transaction Type | Purchase / Refund / Chargeback / Reversal / Representment | `PURCHASE` |
| Transaction State | Captured / Processed / Paid | `PAID` |
| Action Type | AUTH, CAPTURE, AUTH_AND_CAPTURE, AUTH_REVERSAL, etc. | `CAPTURE` |
| Original Transaction ID | For refunds/chargebacks: links to original transaction | `TXN-20260328-1B2C3D4E` |

#### Merchant Information

| Field | Description | Example |
|-------|-------------|---------|
| Merchant ID | Worldline merchant identifier | `90100110` |
| Merchant Name | Registered merchant name | `ACME Online Store` |
| Contract ID | Worldline contract identifier | `CTR-001234` |
| Site ID | Sub-merchant / location / URL | `SITE-00567` |
| Terminal ID | POS terminal (if applicable) | `TERM-890` |
| MCC | Merchant Category Code | `5411` |

#### Financial Information

| Field | Description | Example |
|-------|-------------|---------|
| Transaction Amount | Original transaction amount | `125.50` |
| Transaction Currency | Original currency (ISO 4217) | `EUR` |
| Settlement Amount | Amount in settlement currency | `125.50` |
| Settlement Currency | Settlement currency | `EUR` |
| Interchange Fee | Interchange fee charged by scheme | `0.89` |
| Scheme Fee | Card scheme processing fee | `0.12` |
| Merchant Service Charge | Total acquirer fee to merchant | `2.51` |
| Commission Amount | Commission deducted | `1.50` |
| Net Amount | Amount after all deductions | `122.99` |
| Exchange Rate | FX rate (if multi-currency) | `1.0000` |

#### Card & Scheme Information

| Field | Description | Example |
|-------|-------------|---------|
| Card Scheme | Visa / Mastercard / Other | `VISA` |
| Card Number (masked) | Masked PAN | `4111XXXXXXXX1111` |
| Card Type | Credit / Debit / Prepaid | `CREDIT` |
| Card Product | Product identifier (Gold, Platinum, etc.) | `VISA_CLASSIC` |
| Issuer Country | Country of card issuer | `DE` |
| ECI | Electronic Commerce Indicator | `05` |
| Authorization Code | Auth code from issuer | `A12345` |
| ARN | Acquirer Reference Number | `74012345678901234567890` |
| RRN | Retrieval Reference Number | `260401123456` |

#### Date/Time Fields

| Field | Description | Example |
|-------|-------------|---------|
| Transaction Date/Time | When the transaction occurred | `2026-04-01T14:23:45+02:00` |
| Capture Date | When the capture was processed | `2026-04-01T23:59:59Z` |
| Clearing Date | When sent to scheme for clearing | `2026-04-02T03:00:00Z` |
| Settlement Date | When settlement was calculated | `2026-04-02T06:00:00Z` |
| Payment Date | When merchant payment was created | `2026-04-03T02:00:00Z` |

#### Chargeback / Dispute Fields (when applicable)

| Field | Description | Example |
|-------|-------------|---------|
| Dispute Type | Chargeback / Pre-Arbitration / Representment | `CHARGEBACK` |
| Dispute Reason Code | Scheme-specific reason code | `10.4` (Visa) |
| Dispute Amount | Disputed amount | `125.50` |
| Dispute Currency | Currency of the dispute | `EUR` |
| Dispute Date | Date dispute was raised | `2026-04-01` |
| Original ARN | ARN of the original transaction | `74012345678901234567890` |
| Case ID | Dispute case identifier | `CB-2026-00891` |

### 2.3 File-Level Trailer / Summary

| Field | Description | Example |
|-------|-------------|---------|
| Total Records | Total transaction records in file | `1,680` |
| Total Purchases | Sum of purchase amounts | `245,831.50` |
| Total Refunds | Sum of refund amounts | `8,234.20` |
| Total Chargebacks | Sum of chargeback amounts | `4,222.00` |
| Total Reversals | Sum of reversal amounts | `0.00` |
| Total Fees | Sum of all fees | `3,250.00` |
| Net Settlement Amount | Final net amount to safeguarding account | `230,125.30` |
| Hash Total | Integrity check value | `A3F2B1C4D5E6` |

---

## 3. Example Clearing/Settlement File

### 3.1 Example in CSV Format

This is a **realistic example** of what a Worldline clearing/settlement file would look like in CSV format:

```csv
FILE_HEADER
FILE_ID;ACQUIRER_ID;FILE_DATE;SETTLEMENT_DATE;SETTLEMENT_CURRENCY;TOTAL_DEBIT_COUNT;TOTAL_CREDIT_COUNT;TOTAL_DEBIT_AMOUNT;TOTAL_CREDIT_AMOUNT;NET_SETTLEMENT_AMOUNT;TOTAL_FEES;RECORD_COUNT
CLR-20260403-001;315000001;2026-04-03T02:00:00Z;2026-04-02;EUR;8;3;1523.40;155.00;1339.59;28.81;11

TRANSACTION_RECORDS
TXN_ID;TXN_TYPE;MERCHANT_ID;MERCHANT_NAME;CONTRACT_ID;MCC;TXN_AMOUNT;TXN_CURRENCY;SETTLEMENT_AMOUNT;SETTLEMENT_CURRENCY;INTERCHANGE_FEE;SCHEME_FEE;MSC_FEE;NET_AMOUNT;CARD_SCHEME;CARD_NUMBER_MASKED;CARD_TYPE;ISSUER_COUNTRY;ECI;AUTH_CODE;ARN;RRN;TXN_DATE;CAPTURE_DATE;SETTLEMENT_DATE;DISPUTE_TYPE;DISPUTE_REASON;ORIGINAL_TXN_ID
TXN-001;PURCHASE;90100110;ACME Online Store;CTR-001234;5411;89.99;EUR;89.99;EUR;0.63;0.09;1.80;87.47;VISA;4111XXXXXXXX1111;CREDIT;DE;05;A12345;74012345678901234567890;260401000001;2026-04-01T10:23:15+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-002;PURCHASE;90100110;ACME Online Store;CTR-001234;5411;245.00;EUR;245.00;EUR;1.72;0.24;4.90;238.14;MASTERCARD;5425XXXXXXXX9012;DEBIT;NL;05;B67890;74012345678901234567891;260401000002;2026-04-01T11:45:30+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-003;PURCHASE;90100111;BetaShop EU;CTR-001235;5999;32.50;EUR;32.50;EUR;0.23;0.03;0.65;31.59;VISA;4532XXXXXXXX4567;CREDIT;FR;07;C11111;74012345678901234567892;260401000003;2026-04-01T12:10:00+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-004;PURCHASE;90100111;BetaShop EU;CTR-001235;5999;499.99;EUR;499.99;EUR;3.50;0.49;10.00;486.00;MASTERCARD;5425XXXXXXXX3344;CREDIT;BE;05;D22222;74012345678901234567893;260401000004;2026-04-01T13:30:22+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-005;PURCHASE;90100112;GammaRetail;CTR-001236;5691;155.00;EUR;155.00;EUR;1.09;0.15;3.10;150.66;VISA;4716XXXXXXXX8899;DEBIT;AT;05;E33333;74012345678901234567894;260401000005;2026-04-01T14:15:45+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-006;PURCHASE;90100112;GammaRetail;CTR-001236;5691;78.50;EUR;78.50;EUR;0.55;0.08;1.57;76.30;MASTERCARD;5412XXXXXXXX6677;CREDIT;IT;05;F44444;74012345678901234567895;260401000006;2026-04-01T15:00:10+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-007;PURCHASE;90100110;ACME Online Store;CTR-001234;5411;350.00;EUR;350.00;EUR;2.45;0.35;7.00;340.20;VISA;4111XXXXXXXX2233;CREDIT;ES;05;G55555;74012345678901234567896;260401000007;2026-04-01T16:22:33+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-008;PURCHASE;90100113;DeltaServices;CTR-001237;7299;72.42;EUR;72.42;EUR;0.51;0.07;1.45;70.39;VISA;4539XXXXXXXX5566;DEBIT;DE;05;H66666;74012345678901234567897;260401000008;2026-04-01T17:45:00+02:00;2026-04-01T23:59:59Z;2026-04-02;;;
TXN-009;REFUND;90100110;ACME Online Store;CTR-001234;5411;-45.00;EUR;-45.00;EUR;-0.32;-0.04;-0.90;-43.74;VISA;4111XXXXXXXX1111;CREDIT;DE;05;R11111;74012345678901234567898;260401000009;2026-04-01T09:00:00+02:00;2026-04-01T23:59:59Z;2026-04-02;;;TXN-20260328-ORIG1
TXN-010;REFUND;90100111;BetaShop EU;CTR-001235;5999;-85.00;EUR;-85.00;EUR;-0.60;-0.08;-1.70;-82.62;MASTERCARD;5425XXXXXXXX4567;CREDIT;FR;07;R22222;74012345678901234567899;260401000010;2026-04-01T10:30:00+02:00;2026-04-01T23:59:59Z;2026-04-02;;;TXN-20260325-ORIG2
TXN-011;CHARGEBACK;90100112;GammaRetail;CTR-001236;5691;-25.00;EUR;-25.00;EUR;0.00;0.00;0.00;-25.00;VISA;4716XXXXXXXX8899;DEBIT;AT;;CB1111;74012345678901234567900;260401000011;2026-04-01T00:00:00Z;2026-04-02T00:00:00Z;2026-04-02;CHARGEBACK;10.4;TXN-20260315-ORIG3

FILE_TRAILER
TOTAL_RECORDS;TOTAL_PURCHASES;TOTAL_REFUNDS;TOTAL_CHARGEBACKS;TOTAL_REVERSALS;TOTAL_FEES;NET_SETTLEMENT_AMOUNT
11;1523.40;-130.00;-25.00;0.00;28.81;1339.59
```

### 3.2 Example in JSON Format (API-style)

This is what the equivalent data looks like via the **Worldline REST APIs** (Transactions + Merchant Payments):

```json
{
  "settlementFile": {
    "fileId": "CLR-20260403-001",
    "acquirerId": "315000001",
    "fileCreationDate": "2026-04-03T02:00:00Z",
    "settlementDate": "2026-04-02",
    "settlementCurrency": "EUR",
    "summary": {
      "totalDebitCount": 8,
      "totalCreditCount": 3,
      "totalDebitAmount": 1523.40,
      "totalCreditAmount": 155.00,
      "totalChargebackAmount": 25.00,
      "totalFees": 28.81,
      "netSettlementAmount": 1339.59
    },
    "transactions": [
      {
        "transactionId": "TXN-001",
        "transactionType": "PURCHASE",
        "transactionState": "PAID",
        "merchant": {
          "merchantId": "90100110",
          "merchantName": "ACME Online Store",
          "contractId": "CTR-001234",
          "mcc": "5411"
        },
        "financial": {
          "transactionAmount": 89.99,
          "transactionCurrency": "EUR",
          "settlementAmount": 89.99,
          "settlementCurrency": "EUR",
          "interchangeFee": 0.63,
          "schemeFee": 0.09,
          "merchantServiceCharge": 1.80,
          "netAmount": 87.47
        },
        "card": {
          "scheme": "VISA",
          "maskedPan": "4111XXXXXXXX1111",
          "cardType": "CREDIT",
          "cardProduct": "VISA_CLASSIC",
          "issuerCountry": "DE"
        },
        "references": {
          "authorizationCode": "A12345",
          "acquirerReferenceNumber": "74012345678901234567890",
          "retrievalReferenceNumber": "260401000001",
          "eci": "05"
        },
        "dates": {
          "transactionDateTime": "2026-04-01T10:23:15+02:00",
          "captureDate": "2026-04-01T23:59:59Z",
          "settlementDate": "2026-04-02"
        }
      },
      {
        "transactionId": "TXN-009",
        "transactionType": "REFUND",
        "transactionState": "PAID",
        "originalTransactionId": "TXN-20260328-ORIG1",
        "merchant": {
          "merchantId": "90100110",
          "merchantName": "ACME Online Store",
          "contractId": "CTR-001234",
          "mcc": "5411"
        },
        "financial": {
          "transactionAmount": -45.00,
          "transactionCurrency": "EUR",
          "settlementAmount": -45.00,
          "settlementCurrency": "EUR",
          "interchangeFee": -0.32,
          "schemeFee": -0.04,
          "merchantServiceCharge": -0.90,
          "netAmount": -43.74
        },
        "card": {
          "scheme": "VISA",
          "maskedPan": "4111XXXXXXXX1111",
          "cardType": "CREDIT",
          "issuerCountry": "DE"
        },
        "references": {
          "authorizationCode": "R11111",
          "acquirerReferenceNumber": "74012345678901234567898",
          "retrievalReferenceNumber": "260401000009",
          "eci": "05"
        },
        "dates": {
          "transactionDateTime": "2026-04-01T09:00:00+02:00",
          "captureDate": "2026-04-01T23:59:59Z",
          "settlementDate": "2026-04-02"
        }
      },
      {
        "transactionId": "TXN-011",
        "transactionType": "CHARGEBACK",
        "transactionState": "PAID",
        "originalTransactionId": "TXN-20260315-ORIG3",
        "merchant": {
          "merchantId": "90100112",
          "merchantName": "GammaRetail",
          "contractId": "CTR-001236",
          "mcc": "5691"
        },
        "financial": {
          "transactionAmount": -25.00,
          "transactionCurrency": "EUR",
          "settlementAmount": -25.00,
          "settlementCurrency": "EUR",
          "interchangeFee": 0.00,
          "schemeFee": 0.00,
          "merchantServiceCharge": 0.00,
          "netAmount": -25.00
        },
        "card": {
          "scheme": "VISA",
          "maskedPan": "4716XXXXXXXX8899",
          "cardType": "DEBIT",
          "issuerCountry": "AT"
        },
        "dispute": {
          "disputeType": "CHARGEBACK",
          "reasonCode": "10.4",
          "caseId": "CB-2026-00891"
        },
        "references": {
          "acquirerReferenceNumber": "74012345678901234567900",
          "retrievalReferenceNumber": "260401000011"
        },
        "dates": {
          "transactionDateTime": "2026-04-01T00:00:00Z",
          "settlementDate": "2026-04-02"
        }
      }
    ]
  }
}
```

---

## 4. How the Settlement Flow Works

```
                                    WORLDLINE FS
                                    Back Office
                                    
Cardholder → Merchant → [AUTH] → WL Front Office → Issuer
                         [CAPTURE] → WL Front Office
                                        ↓
                              WL Back Office processes
                              CAPTURED → PROCESSED → PAID
                                        ↓
                         Scheme Clearing Files received
                         (Visa TC33A / Mastercard IPM/DCF)
                                        ↓
                         Merchant Settlement Module
                         - Applies pricing engine (fees)
                         - Matches with merchant contracts
                         - Calculates net amounts
                                        ↓
                    ┌────────────────────┴────────────────────┐
                    ↓                                        ↓
         Data Warehouse Feed                          REST APIs
         (SFTP bulk file daily)              (Transactions, Merchant
         - Authorizations feed                Payments, Statements)
         - Clearing feed ← THIS IS YOUR FILE
         - Merchant Payments feed
                    ↓                                        ↓
              YOUR PLATFORM                          YOUR PLATFORM
              Parses the file                     Calls APIs to get data
              Reconciles with                     Real-time reconciliation
              safeguarding account
                    ↓
         SCT/SDD Payment Instructions
         → Money lands on safeguarding account
```

### Key Points:
1. Worldline receives **raw scheme clearing files** (Visa BASE II/TC33A, Mastercard GCMS/IPM)
2. Worldline's **Merchant Settlement module** processes these into merchant-level settlement data
3. The output is delivered to you as a **Clearing Data Warehouse Feed** (file) or via **APIs**
4. The file tells you: for each transaction, the gross amount, all fees deducted, and the net amount that hit the safeguarding account
5. The actual money movement is done via **SCT (SEPA Credit Transfer)** or **SDD (SEPA Direct Debit)**

---

## 5. Transaction Types You'll See in the File

| Transaction Type | Direction | Description |
|-----------------|-----------|-------------|
| **PURCHASE** | Debit (+) | Standard card payment |
| **REFUND** | Credit (-) | Merchant-initiated refund |
| **CHARGEBACK** | Credit (-) | Cardholder dispute — money clawed back |
| **CHARGEBACK_REVERSAL** | Debit (+) | Chargeback reversed (merchant won dispute) |
| **REPRESENTMENT** | Debit (+) | Merchant re-presents a disputed transaction |
| **PRE_ARBITRATION** | Credit (-) | Pre-arbitration stage of dispute |
| **REVERSAL** | Credit (-) | Technical reversal of a transaction |
| **ADJUSTMENT** | Debit/Credit | Manual correction by the acquirer |
| **FEE** | Credit (-) | Scheme fees, processing fees charged |

---

## 6. Industry Context: Underlying Scheme Clearing Files

Although you won't receive these directly, understanding them helps you interpret what Worldline provides:

### Visa: TC33A (Transaction Capture 33 Acquirer)
- Visa's settlement report sent to acquiring members
- Part of Visa's **BASE II** clearing system via **VisaNet**
- Contains all cleared Visa transactions with financial details
- Delivered daily

### Mastercard: IPM (Integrated Product Messages) / DCF (Daily Clearing File)
- Mastercard's clearing format via **GCMS** (Global Clearing Management System)
- IPM is based on ISO 8583 message format
- Contains all cleared Mastercard transactions
- DCF = the daily file containing IPM records

### What Worldline Does With These
Worldline receives TC33A and IPM/DCF files from the schemes, reconciles them against captured transactions, applies the merchant pricing engine, and produces **their own clearing/settlement output** which is what you receive.

---

## 7. Relevant Documentation Links

### Primary: Worldline FS Acquiring (your acquirer)
| Resource | URL |
|----------|-----|
| **Introduction (clearing & settlement overview)** | [Link](https://financial-services.developer.worldline.com/acquiring/documentation?page=/acquiring/introduction) |
| **Transactions API** (transaction states, clearing data) | [Link](https://financial-services.developer.worldline.com/acquiring/documentation?page=/acquiring/transactions) |
| **Merchant Payments API** (payment/settlement data) | [Link](https://financial-services.developer.worldline.com/acquiring/documentation?page=/acquiring/merchant-payments) |
| **Statements API** (reconciliation statements) | [Link](https://financial-services.developer.worldline.com/acquiring/documentation?page=/acquiring/statements-description) |
| **Merchant Management** (contract hierarchy, settlement module) | [Link](https://financial-services.developer.worldline.com/acquiring/documentation?page=/acquiring/Merchant-management) |
| **Interchange Fees API** | [Link](https://financial-services.developer.worldline.com/acquiring/documentation?page=/acquiring/interchange-fees-description) |
| **API Reference (OpenAPI specs)** | [Link](https://financial-services.developer.worldline.com/acquiring/accept-transactions-API) |

### Secondary: Other Worldline Platforms (for reference)
| Resource | URL |
|----------|-----|
| **Processor Settlements V2 API** (detailed field specs) | [Link](https://developer.payments.worldline.com/references/processor-settlements/settlements-rest-api.html) |
| **Settlement Details API** (ARN, RRN retrieval) | [Link](https://apireference.connect.worldline-solutions.com/s2sapi/v1/en_US/go/services/settlementdetails.html) |
| **WX File & Financial Report overview** | [Link](https://docs.connect.worldline-solutions.com/reporting/) |
| **Sips Financial Reconciliation Reports** (JRB field list) | [Link](https://docs.direct.worldline-solutions.com/en/migrate/migrate-from-sips/manage-your-reports) |
| **Settlement Report API (NAM)** | [Link](https://docs.na.worldline-solutions.com/build-your-integration/reporting-apis/settlement-report) |
| **Reconciliation FAQ** | [Link](https://docs.connect.worldline-solutions.com/support/faq/connect/reconciliation-and-reporting) |

---

## 8. Next Steps for Your Integration

1. **Request the Data Warehouse Feed specification** from your Worldline FS account manager — this is the detailed clearing file format with all field definitions, record types, and validation rules. It's provided under NDA.

2. **Request API access** to the Transactions, Merchant Payments, and Statements APIs if you want programmatic access in addition to (or instead of) file-based feeds.

3. **Clarify the delivery mechanism** — typically SFTP with PGP encryption for file-based feeds.

4. **Understand the settlement cycle** — Worldline typically settles T+1 or T+2 depending on your contract. Ask about cut-off times.

5. **Map the file fields to your platform's data model** — use the field tables in Section 2 as a starting point for your parser design.

6. **Contact**: The Worldline FS API team can be reached at `dl-fr-dp2si-acquiring@worldline.com` (from their OpenAPI spec).

---

## 9. Key Terminology Mapping

| Your Term | Worldline Term | Scheme Term |
|-----------|---------------|-------------|
| Settlement file | Clearing Data Warehouse Feed / Merchant Payments | TC33A (Visa) / IPM-DCF (Mastercard) |
| Movement file | Clearing feed / Transaction records | Clearing records |
| How money landed | Net Settlement Amount per merchant | Settlement position |
| Safeguarding account | Merchant settlement account (SCT/SDD) | N/A |
| Negative transaction | Refund / Chargeback / Reversal | Credit transaction |
| Card schema info | Card Scheme + Card Type + Card Product | BIN / Product ID |
