import argparse
import csv
import datetime
import os
import random
from decimal import ROUND_HALF_UP, Decimal


def generate_exact_chase_dfr(base_filename, num_merchants, num_txn_rows, num_cb_rows):
    """
    Generates Chase Paymentech DFR files with exact row counts for load testing.
    """
    merchants = [
        str(random.randint(700000000000, 799999999999)) for _ in range(num_merchants)
    ]
    card_types = ["VI", "MC", "AX", "DI"]

    target_date = datetime.date.today() - datetime.timedelta(days=1)
    settle_date_str = target_date.strftime("%Y%m%d")

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

    print(f"Generating {num_txn_rows} Settlement Records...")
    for _ in range(num_txn_rows):
        merchant_id = random.choice(merchants)
        terminal_id = str(random.randint(1001, 1099))
        batch_num = str(random.randint(100000, 999999))
        card = random.choice(card_types)

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

    print(f"Generating {num_cb_rows} Chargeback Records...")
    for _ in range(num_cb_rows):
        merchant_id = random.choice(merchants)
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

    # --- 3. WRITE FILES ---
    output_dir = os.path.join(".", "dist", "chase")
    os.makedirs(output_dir, exist_ok=True)

    pds_file = os.path.join(
        output_dir, f"{base_filename}_PDS0200_{settle_date_str}.csv"
    )
    with open(pds_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(pds0200_headers)
        writer.writerows(pds0200_rows)
    print(f"Saved: {pds_file}")

    pde_file = os.path.join(
        output_dir, f"{base_filename}_PDE0017_{settle_date_str}.csv"
    )
    with open(pde_file, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(pde0017_headers)
        writer.writerows(pde0017_rows)
    print(f"Saved: {pde_file}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--merchants", type=int, default=10, help="Number of distinct Merchant IDs"
    )
    parser.add_argument(
        "--txns",
        type=int,
        default=1000,
        help="Exact number of settlement rows (PDS0200)",
    )
    parser.add_argument(
        "--cbs", type=int, default=50, help="Exact number of chargeback rows (PDE0017)"
    )
    parser.add_argument("--prefix", type=str, default="CHASE_DFR", help="File prefix")
    args = parser.parse_args()

    generate_exact_chase_dfr(args.prefix, args.merchants, args.txns, args.cbs)
