import argparse
import csv
import datetime
import os
import random
from decimal import ROUND_HALF_UP, Decimal


def generate_worldpay_settlement(filename, num_rows, num_merchants):
    """
    Generates a mock Worldpay Settlement Report.

    Worldpay Logic:
    - This is a SUMMARY report, not a transaction-level report.
    - Each row aggregates the totals for a specific Reporting Group and Payment Type.
    - 'Net Settlement' is the calculated total of Deposits + Refunds + Chargebacks + Fees.
    """

    # Standard Worldpay Activity/Settlement Report Columns
    headers = [
        "Reporting Group",
        "Reporting Group Type",
        "Merchant",
        "Payment Type",
        "Activity Date",
        "Settlement Date",
        "Settlement Currency",
        "Net Settlement",
        "Settled Deposits",
        "Settled Refunds",
        "Chargebacks/Returns",
        "Vantiv Fees",
        "Passthrough Fees",
        "Reserve Activity",
        "3rd Party Payments",
        "Count",
        "Presenter",
        "Merchant ID",
        "Worldpay Transfer Id",
    ]

    currency = "USD"
    presenter_name = "WP_PRESENTER"

    # Generate Mock Merchants / Reporting Groups
    merchants = [f"TechCorp_Div_{i:02d}" for i in range(1, num_merchants + 1)]
    payment_types = [
        "VI",
        "MC",
        "AX",
        "DI",
        "eCheck",
    ]  # Visa, Mastercard, Amex, Discover

    rows = []

    target_date = datetime.date.today() - datetime.timedelta(days=1)
    activity_date_str = (target_date - datetime.timedelta(days=1)).strftime("%m/%d/%Y")
    settlement_date_str = target_date.strftime("%m/%d/%Y")

    print("Generating Worldpay Settlement Summary Report...")

    for _ in range(num_rows):
        merchant_name = random.choice(merchants)
        merchant_id = str(random.randint(800000000000, 899999999999))
        reporting_group = f"RG_{merchant_name}"
        payment_type = random.choice(payment_types)

        # Aggregate totals for the summary row
        txn_count = random.randint(10, 500)

        # Positive inbound amounts
        settled_deposits = Decimal(random.uniform(1000.0, 50000.0)).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

        # Negative outbound/deduction amounts (Represented as negative decimals for balancing)
        # Refunds approx 5% of volume
        settled_refunds = -(
            settled_deposits * Decimal(random.uniform(0.01, 0.05))
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        # Chargebacks approx 1% of volume
        chargebacks = -(
            settled_deposits * Decimal(random.uniform(0.00, 0.01))
        ).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

        # Vantiv (Worldpay) processing fees approx 1.2%
        vantiv_fees = -(settled_deposits * Decimal("0.012")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

        # Network Passthrough fees approx 0.8%
        passthrough_fees = -(settled_deposits * Decimal("0.008")).quantize(
            Decimal("0.01"), rounding=ROUND_HALF_UP
        )

        # Occasional Reserve withholdings
        reserve_activity = Decimal("0.00")
        if random.random() < 0.10:
            reserve_activity = -(settled_deposits * Decimal("0.05")).quantize(
                Decimal("0.01"), rounding=ROUND_HALF_UP
            )

        # 3rd Party Payments (rarely applies, keeping at 0 for standard flow)
        third_party_payments = Decimal("0.00")

        # Calculate final Net Settlement
        net_settlement = (
            settled_deposits
            + settled_refunds
            + chargebacks
            + vantiv_fees
            + passthrough_fees
            + reserve_activity
            + third_party_payments
        )

        transfer_id = str(random.randint(1000000000000000000, 9999999999999999999))

        rows.append(
            [
                reporting_group,
                "Transactional",
                merchant_name,
                payment_type,
                activity_date_str,
                settlement_date_str,
                currency,
                net_settlement,
                settled_deposits,
                settled_refunds,
                chargebacks,
                vantiv_fees,
                passthrough_fees,
                reserve_activity,
                third_party_payments,
                txn_count,
                presenter_name,
                merchant_id,
                transfer_id,
            ]
        )

    # Write to File
    output_dir = os.path.join(".", "dist", "worldpay")
    os.makedirs(output_dir, exist_ok=True)
    filepath = os.path.join(output_dir, filename)
    with open(filepath, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        writer.writerows(rows)

    print(f"Success. File '{filepath}' created.")
    print(f"Total Summary Rows: {num_rows}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--rows", type=int, default=20)
    parser.add_argument("--merchants", type=int, default=5)
    parser.add_argument(
        "--file",
        type=str,
        default="Financial_Summary_SettlementReport_0_12345_20260305.csv",
    )
    args = parser.parse_args()

    generate_worldpay_settlement(args.file, args.rows, args.merchants)
