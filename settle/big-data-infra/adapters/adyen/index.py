import os
from decimal import Decimal

import awswrangler as wr  # type: ignore

# Adyen Type values we care about
RELEVANT_TYPES = {"Settled", "Refunded", "Chargeback", "ChargebackReversed"}


def handler(event, context):
    clean_bucket = os.environ["CLEAN_BUCKET"]

    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        input_path = f"s3://{bucket}/{key}"

        # 1. Map exactly to Adyen headers
        use_cols = [
            "Payment Method",
            "Type",
            "Net Credit (NC)",
            "Net Debit (NC)",
        ]

        # 2. Read in chunks to respect Lambda memory
        dfs = wr.s3.read_csv(path=input_path, usecols=use_cols, chunksize=100_000)

        for i, df in enumerate(dfs):
            # 3. Keep only the transaction types we care about
            df = df[df["Type"].isin(RELEVANT_TYPES)].copy()

            if df.empty:
                continue

            # 4. Rename columns to match the clean Glue/Athena schema
            df = df.rename(
                columns={
                    "Payment Method": "payment_type",
                    "Type": "type",
                    "Net Credit (NC)": "net_credit",
                    "Net Debit (NC)": "net_debit",
                }
            )

            # 5. Normalise type labels to a consistent platform vocabulary
            df["type"] = df["type"].map(
                {
                    "Settled": "settled",
                    "Refunded": "refunded",
                    "Chargeback": "chargeback",
                    "ChargebackReversed": "chargeback_reversal",
                }
            )

            # 6. Handle empty cells and cast to exact Decimals
            df["net_credit"] = df["net_credit"].fillna(0).astype(str).apply(Decimal)
            df["net_debit"] = df["net_debit"].fillna(0).astype(str).apply(Decimal)

            output_path = f"s3://{clean_bucket}/acquirer=adyen/batch_{i}.parquet"

            # 7. Write highly compressed Parquet
            wr.s3.to_parquet(
                df=df,
                path=output_path,
                dataset=True,
                dtype={
                    "net_credit": "decimal(19,4)",
                    "net_debit": "decimal(19,4)",
                },
            )

    return {"status": "success"}
