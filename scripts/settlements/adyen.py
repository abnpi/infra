import argparse
import csv
import datetime
import os
import random
from decimal import ROUND_HALF_UP, Decimal


def generate_adyen_settlement(filename, num_rows, num_merchants):
    """
    Generates a mock Adyen Settlement Detail Report (SDR).

    Adyen Logic:
    - Single CSV file containing Sales, Refunds, Chargebacks, and Payouts.
    - 'Type' column determines the movement (Settled, Refunded, Chargeback, etc.).
    - 'Net Credit (NC)' = Money Adyen owes you (Sales).
    - 'Net Debit (NC)' = Money you owe Adyen (Refunds, Chargebacks, Fees).
    - 'MerchantPayout' = The final balancing line item representing the bank transfer.
    """

    # Standard Adyen SDR Columns
    headers = [
        "Company Account",
        "Merchant Account",
        "Psp Reference",
        "Merchant Reference",
        "Payment Method",
        "Creation Date",
        "TimeZone",
        "Type",  # The "Journal Type"
        "Modification Reference",
        "Gross Currency",
        "Gross Debit (GC)",
        "Gross Credit (GC)",
        "Exchange Rate",
        "Net Currency",
        "Net Debit (NC)",
        "Net Credit (NC)",
        "Commission (NC)",
        "Markup (NC)",
        "Scheme Fees (NC)",
        "Interchange (NC)",
        "Batch Number",
    ]

    # Configuration
    company_account = "TechCorp_Global_Holdings"
    currency = "EUR"  # Adyen is Euro-centric, but this works for USD too

    # Generate Mock Merchants
    merchants = [f"TechCorp_Sub_{i:02d}" for i in range(1, num_merchants + 1)]

    rows = []

    # We simulate ONE batch (e.g., Batch #4501) to show how it balances
    batch_number = random.randint(4000, 9999)
    batch_total = Decimal("0.00")

    base_date = datetime.date.today() - datetime.timedelta(days=2)

    print(f"Generating Adyen Report for Batch #{batch_number}...")

    for _ in range(num_rows):
        merchant_account = random.choice(merchants)
        psp_ref = str(random.randint(1000000000000000, 9999999999999999))
        merchant_ref = f"ORD-{random.randint(100000, 999999)}"
        payment_method = random.choice(["visa", "mc", "amex", "paypal"])

        # Transaction Amount
        amount = Decimal(random.uniform(20.0, 500.0)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

        # Adyen Fee Simulation (approx 1.5%)
        fee = (amount * Decimal("0.015")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )
        net_amount = amount - fee

        # Determine Transaction Type (Journal Type)
        rand = random.random()

        row_data = {
            "Type": "",
            "Gross Debit": "",
            "Gross Credit": "",
            "Net Debit": "",
            "Net Credit": "",
            "Mod Ref": "",
        }

        # --- LOGIC: 80% Sales, 10% Refunds, 5% Chargebacks, 5% Reversals ---

        if rand < 0.80:
            # SALE (Settled)
            # Money comes IN to you (Credit)
            row_data["Type"] = "Settled"
            row_data["Gross Credit"] = amount
            row_data["Net Credit"] = net_amount
            batch_total += net_amount

        elif rand < 0.90:
            # REFUND (Refunded)
            # Money goes OUT from you (Debit)
            row_data["Type"] = "Refunded"
            row_data["Gross Debit"] = amount
            # Refund usually refunds the gross, fees are rarely returned fully
            row_data["Net Debit"] = amount
            row_data["Mod Ref"] = f"REF-{random.randint(1000, 9999)}"
            batch_total -= amount

        elif rand < 0.95:
            # CHARGEBACK (Chargeback)
            # Money goes OUT from you (Debit) + Chargeback Fee
            cb_fee = Decimal("25.00")  # Standard dispute fee
            total_debit = amount + cb_fee

            row_data["Type"] = "Chargeback"
            row_data["Gross Debit"] = amount
            row_data["Net Debit"] = total_debit
            row_data["Mod Ref"] = f"CB-{random.randint(1000, 9999)}"
            batch_total -= total_debit

        else:
            # CHARGEBACK REVERSAL (ChargebackReversed)
            # Money comes back IN (Credit)
            row_data["Type"] = "ChargebackReversed"
            row_data["Gross Credit"] = amount
            row_data["Net Credit"] = amount
            row_data["Mod Ref"] = f"REV-{random.randint(1000, 9999)}"
            batch_total += amount

        # Append Transaction Row
        rows.append(
            [
                company_account,
                merchant_account,
                psp_ref,
                merchant_ref,
                payment_method,
                base_date.strftime("%Y-%m-%d %H:%M:%S"),
                "CET",
                row_data["Type"],
                row_data["Mod Ref"],
                currency,
                row_data[
                    "Gross Debit"
                ],  # Adyen uses empty string for 0 in CSVs often, but handled below
                row_data["Gross Credit"],
                "1.0000",
                currency,
                row_data["Net Debit"],
                row_data["Net Credit"],
                fee if row_data["Type"] == "Settled" else "",  # Commission
                "",
                "",
                "",  # Markup/Scheme/Interchange left blank for simplicity
                batch_number,
            ]
        )

    # --- THE PAYOUT ROW ---
    # This is the critical row that confuses people.
    # Adyen adds a row at the bottom to show the money leaving to your bank.
    # It balances the Net Credit and Net Debit of the whole batch.

    payout_row = [
        company_account,
        "BATCH_LEVEL",  # Payouts are often batch level, not specific merchant level
        "",  # No PSP ref
        f"PAYOUT-{batch_number}",
        "bank_transfer",
        datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "CET",
        "MerchantPayout",  # <--- THE KEY IDENTIFIER
        "",
        currency,
        "",
        "",
        "1.0000",
        currency,
        batch_total,  # Net Debit (Money leaving Adyen ledger -> Your Bank)
        "",
        "",
        "",
        "",
        "",
        batch_number,
    ]
    rows.append(payout_row)

    # Write to File
    output_dir = os.path.join(".", "dist", "adyen")
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"Success. File '{filepath}' created.")
    print(f"Total Transactions: {num_rows}")
    print(f"Net Payout Amount: {batch_total} {currency}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=50)
    parser.add_argument("--merchants", type=int, default=5)
    parser.add_argument("--file", type=str, default="adyen_sdr_test.csv")
    args = parser.parse_args()

    generate_adyen_settlement(args.file, args.rows, args.merchants)
