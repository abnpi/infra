import argparse
import csv
import datetime
import os
import random
from decimal import ROUND_HALF_UP, Decimal


def generate_chase_dfr_files(base_filename, num_merchants, base_rows):
    """
    Generates mock Chase Paymentech DFR (Delimited File Reporting) files.
    Outputs two files: PDS0200 (Settlement) and PDE0017 (Chargebacks).
    """

    # Chase Paymentech Standard Identifiers
    merchants = [
        str(random.randint(700000000000, 799999999999)) for _ in range(num_merchants)
    ]
    card_types = ["VI", "MC", "AX", "DI"]

    target_date = datetime.date.today() - datetime.timedelta(days=1)
    settle_date_str = target_date.strftime("%Y%m%d")  # DFR often uses YYYYMMDD

    # --- 1. PDS0200 SETTLEMENT DETAIL ---
    pds0200_headers = [
        "Merchant_ID",
        "Terminal_ID",
        "Batch_Number",
        "Settle_Date",
        "Card_Type",
        "Transaction_Count",
        "Gross_Amount",
        "Refund_Amount",
        "Discount_Amount",
        "Net_Settlement_Amount",
        "Funded_Currency",
    ]
    pds0200_rows = []

    # --- 2. PDE0017 CHARGEBACK ACTIVITY ---
    pde0017_headers = [
        "Merchant_ID",
        "Terminal_ID",
        "Case_Number",
        "Chargeback_Date",
        "Original_Settle_Date",
        "Card_Type",
        "Reason_Code",
        "Action_Type",
        "Chargeback_Amount",
        "Chargeback_Currency",
    ]
    pde0017_rows = []

    print("Generating Chase Paymentech DFR Mock Files...")

    for merchant_id in merchants:
        # Generate 1 to 5 settlement batches per merchant
        for _ in range(random.randint(1, 5)):
            terminal_id = str(random.randint(1001, 1099))
            batch_num = str(random.randint(100000, 999999))
            card = random.choice(card_types)

            # Settlement Math
            txn_count = random.randint(50, 500)
            gross = Decimal(random.uniform(5000.0, 50000.0)).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            refunds = -(gross * Decimal(random.uniform(0.01, 0.05))).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            discount = -(gross * Decimal(random.uniform(0.015, 0.025))).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )
            net = gross + refunds + discount

            pds0200_rows.append(
                [
                    merchant_id,
                    terminal_id,
                    batch_num,
                    settle_date_str,
                    card,
                    txn_count,
                    gross,
                    refunds,
                    discount,
                    net,
                    "USD",
                ]
            )

        # Generate Chargebacks for a subset of merchants (approx 40% will have dispute activity on a given day)
        if random.random() < 0.40:
            for _ in range(random.randint(1, 3)):
                terminal_id = str(random.randint(1001, 1099))
                case_num = f"CBK{random.randint(10000000, 99999999)}"
                orig_date = (
                    target_date - datetime.timedelta(days=random.randint(15, 90))
                ).strftime("%Y%m%d")
                card = random.choice(card_types)
                reason_code = random.choice(["30", "4837", "10.4", "85", "C08"])

                action_type = random.choice(
                    ["CHARGEBACK_RECEIVED", "CHARGEBACK_RECEIVED", "REVERSAL_CREDIT"]
                )

                # Chargebacks are positive numbers in the file, but represent debits to your account
                # Reversals represent funds returned to you
                amount = Decimal(random.uniform(25.0, 300.0)).quantize(
                    Decimal("0.01"), rounding=ROUND_HALF_UP
                )

                pde0017_rows.append(
                    [
                        merchant_id,
                        terminal_id,
                        case_num,
                        settle_date_str,
                        orig_date,
                        card,
                        reason_code,
                        action_type,
                        amount,
                        "USD",
                    ]
                )

    output_dir = os.path.join(".", "dist", "chase")
    os.makedirs(output_dir, exist_ok=True)

    # Write PDS0200
    pds_file = os.path.join(
        output_dir, f"{base_filename}_PDS0200_{settle_date_str}.csv"
    )
    with open(pds_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(pds0200_headers)
        writer.writerows(pds0200_rows)
    print(f"Created: {pds_file} ({len(pds0200_rows)} records)")

    # Write PDE0017
    pde_file = os.path.join(
        output_dir, f"{base_filename}_PDE0017_{settle_date_str}.csv"
    )
    with open(pde_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(pde0017_headers)
        writer.writerows(pde0017_rows)
    print(f"Created: {pde_file} ({len(pde0017_rows)} records)")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--merchants", type=int, default=10)
    parser.add_argument("--rows", type=int, default=50)
    parser.add_argument("--prefix", type=str, default="CHASE_DFR")
    args = parser.parse_args()

    generate_chase_dfr_files(args.prefix, args.merchants, args.rows)
