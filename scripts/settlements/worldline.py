import argparse
import datetime
import os
import random
import uuid
from decimal import ROUND_HALF_UP, Decimal

def generate_clearing_file(filename, num_rows, num_merchants):
    """
    Generates a multi-section Clearing Data File.
    
    Format:
    - FILE_HEADER: Summary data.
    - TRANSACTION_RECORDS: Line-item transactions.
    - FILE_TRAILER: Final verification totals.
    """
    
    # Configuration
    acquirer_id = "315000001"
    currency = "EUR"
    file_id = f"CLR-{datetime.date.today().strftime('%Y%m%d')}-{random.randint(100, 999)}"
    
    now = datetime.datetime.now(datetime.timezone.utc)
    file_date = now.strftime("%Y-%m-%dT%H:%M:%SZ")
    settlement_date = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%d")

    # Generate Mock Merchants
    merchants = []
    for i in range(1, num_merchants + 1):
        merchants.append({
            "id": f"901001{i:02d}",
            "name": f"Merchant Store {i}",
            "contract_id": f"CTR-0012{i:02d}",
            "mcc": random.choice(["5411", "5999", "5691", "7299", "5812"])
        })

    # Tallies
    total_debit_count = 0
    total_credit_count = 0
    total_debit_amount = Decimal("0.00")
    total_credit_amount = Decimal("0.00")
    
    total_purchases = Decimal("0.00")
    total_refunds = Decimal("0.00")
    total_chargebacks = Decimal("0.00")
    total_fees = Decimal("0.00")
    net_settlement_amount = Decimal("0.00")

    transaction_records = []

    print(f"Generating Clearing File '{file_id}' with {num_rows} transactions...")

    for i in range(1, num_rows + 1):
        merchant = random.choice(merchants)
        txn_id = f"TXN-{i:03d}"
        
        # Base Amount
        base_amount = Decimal(random.uniform(10.0, 600.0)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
        
        card_scheme = random.choice(["VISA", "MASTERCARD"])
        card_type = random.choice(["CREDIT", "DEBIT"])
        country = random.choice(["DE", "FR", "NL", "BE", "AT", "IT", "ES"])
        
        # Randomize transaction type (80% Purchase, 15% Refund, 5% Chargeback)
        rand = random.random()
        
        interchange_fee = Decimal("0.00")
        scheme_fee = Decimal("0.00")
        msc_fee = Decimal("0.00")
        net_amount = Decimal("0.00")
        
        dispute_type = ""
        dispute_reason = ""
        original_txn_id = ""
        
        if rand < 0.80:
            txn_type = "PURCHASE"
            txn_amount = base_amount
            
            # Simulated standard fees
            interchange_fee = (txn_amount * Decimal("0.007")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            scheme_fee = (txn_amount * Decimal("0.001")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            msc_fee = (txn_amount * Decimal("0.02")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            
            net_amount = txn_amount - (interchange_fee + scheme_fee + msc_fee)
            
            total_purchases += txn_amount
            total_debit_count += 1
            total_debit_amount += txn_amount
            
        elif rand < 0.95:
            txn_type = "REFUND"
            txn_amount = -base_amount
            original_txn_id = f"TXN-{now.strftime('%Y%m%d')}-ORIG{random.randint(1000, 9999)}"
            
            # Usually proportional fee returns
            interchange_fee = (txn_amount * Decimal("0.007")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            scheme_fee = (txn_amount * Decimal("0.001")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            msc_fee = (txn_amount * Decimal("0.02")).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
            
            net_amount = txn_amount - (interchange_fee + scheme_fee + msc_fee)
            
            total_refunds += txn_amount
            total_credit_count += 1
            total_credit_amount += abs(txn_amount)
            
        else:
            txn_type = "CHARGEBACK"
            txn_amount = -base_amount
            dispute_type = "CHARGEBACK"
            dispute_reason = "10.4"
            original_txn_id = f"TXN-{now.strftime('%Y%m%d')}-ORIG{random.randint(1000, 9999)}"
            
            # Typically zero percentage fees on chargebacks, handled by flat CB fee
            net_amount = txn_amount
            
            total_chargebacks += txn_amount
            total_credit_count += 1
            total_credit_amount += abs(txn_amount)

        # Accumulate fees (only Interchange + Scheme + MSC)
        row_total_fees = interchange_fee + scheme_fee + msc_fee
        total_fees += row_total_fees

        # Masked card generation
        prefix = "4" if card_scheme == "VISA" else "54"
        card_masked = f"{prefix}{str(random.randint(100, 999))}XXXXXXXX{random.randint(1000, 9999)}"

        auth_code = f"{random.choice('ABCDEFGH')}{random.randint(10000, 99999)}" if txn_type != "CHARGEBACK" else ""
        arn = f"7401234567890123456{random.randint(1000, 9999)}"
        rrn = f"{now.strftime('%y%m%d')}00{i:04d}"
        
        txn_date = (now - datetime.timedelta(hours=random.randint(1, 24))).strftime("%Y-%m-%dT%H:%M:%S+02:00")
        capture_date = now.replace(hour=23, minute=59, second=59).strftime("%Y-%m-%dT%H:%M:%SZ")
        if txn_type == "CHARGEBACK":
            txn_date = (now - datetime.timedelta(days=1)).strftime("%Y-%m-%dT00:00:00Z")
            capture_date = now.replace(hour=0, minute=0, second=0).strftime("%Y-%m-%dT00:00:00Z")

        # Compile row
        transaction_records.append([
            txn_id, txn_type, merchant["id"], merchant["name"], merchant["contract_id"], merchant["mcc"],
            f"{txn_amount:.2f}", currency, f"{txn_amount:.2f}", currency, f"{interchange_fee:.2f}", 
            f"{scheme_fee:.2f}", f"{msc_fee:.2f}", f"{net_amount:.2f}", card_scheme, card_masked, card_type,
            country, "05" if txn_type != "CHARGEBACK" else "", auth_code, arn, rrn, txn_date, capture_date,
            settlement_date, dispute_type, dispute_reason, original_txn_id
        ])

    # Final Calculations
    net_settlement_amount = total_purchases + total_refunds + total_chargebacks - total_fees

    output_dir = os.path.join(".", "dist", "clearing")
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)

    with open(filepath, "w", encoding="utf-8") as f:
        # 1. Write Header Block
        f.write("FILE_HEADER\n")
        f.write("FILE_ID;ACQUIRER_ID;FILE_DATE;SETTLEMENT_DATE;SETTLEMENT_CURRENCY;TOTAL_DEBIT_COUNT;TOTAL_CREDIT_COUNT;TOTAL_DEBIT_AMOUNT;TOTAL_CREDIT_AMOUNT;NET_SETTLEMENT_AMOUNT;TOTAL_FEES;RECORD_COUNT\n")
        header_data = [
            file_id, acquirer_id, file_date, settlement_date, currency,
            str(total_debit_count), str(total_credit_count), f"{total_debit_amount:.2f}", 
            f"{total_credit_amount:.2f}", f"{net_settlement_amount:.2f}", f"{total_fees:.2f}", str(num_rows)
        ]
        f.write(";".join(header_data) + "\n\n")

        # 2. Write Transactions Block
        f.write("TRANSACTION_RECORDS\n")
        f.write("TXN_ID;TXN_TYPE;MERCHANT_ID;MERCHANT_NAME;CONTRACT_ID;MCC;TXN_AMOUNT;TXN_CURRENCY;SETTLEMENT_AMOUNT;SETTLEMENT_CURRENCY;INTERCHANGE_FEE;SCHEME_FEE;MSC_FEE;NET_AMOUNT;CARD_SCHEME;CARD_NUMBER_MASKED;CARD_TYPE;ISSUER_COUNTRY;ECI;AUTH_CODE;ARN;RRN;TXN_DATE;CAPTURE_DATE;SETTLEMENT_DATE;DISPUTE_TYPE;DISPUTE_REASON;ORIGINAL_TXN_ID\n")
        for record in transaction_records:
            f.write(";".join(record) + "\n")
        f.write("\n")

        # 3. Write Trailer Block
        f.write("FILE_TRAILER\n")
        f.write("TOTAL_RECORDS;TOTAL_PURCHASES;TOTAL_REFUNDS;TOTAL_CHARGEBACKS;TOTAL_REVERSALS;TOTAL_FEES;NET_SETTLEMENT_AMOUNT\n")
        trailer_data = [
            str(num_rows), f"{total_purchases:.2f}", f"{total_refunds:.2f}", 
            f"{total_chargebacks:.2f}", "0.00", f"{total_fees:.2f}", f"{net_settlement_amount:.2f}"
        ]
        f.write(";".join(trailer_data) + "\n")

    print(f"Success. File '{filepath}' created.")
    print(f"Purchases: {total_purchases} | Refunds: {total_refunds} | CBs: {total_chargebacks}")
    print(f"Net Settlement Amount: {net_settlement_amount} {currency}")

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=11)
    parser.add_argument("--merchants", type=int, default=4)
    parser.add_argument("--file", type=str, default="clearing_report_test.csv")
    args = parser.parse_args()

    generate_clearing_file(args.file, args.rows, args.merchants)
