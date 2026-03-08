import os
from decimal import Decimal

import awswrangler as wr  # type: ignore
import pandas as pd


def handler(event, context):
    clean_bucket = os.environ["CLEAN_BUCKET"]

    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        input_path = f"s3://{bucket}/{key}"

        # 1. Map exactly to Worldpay settlement report headers
        use_cols = [
            "Payment Type",
            "Settled Deposits",
            "Settled Refunds",
            "Chargebacks/Returns",
        ]

        # 2. Read in chunks to respect Lambda memory
        dfs = wr.s3.read_csv(path=input_path, usecols=use_cols, chunksize=100_000)

        for i, df in enumerate(dfs):
            # 3. Rename source columns before unpivoting
            df = df.rename(
                columns={
                    "Payment Type": "payment_type",
                    "Settled Deposits": "settled",
                    "Settled Refunds": "refunded",
                    "Chargebacks/Returns": "chargeback",
                }
            )

            # 4. Handle empty cells and cast to exact Decimals
            for col in ["settled", "refunded", "chargeback"]:
                df[col] = df[col].fillna(0).astype(str).apply(Decimal)

            # 5. Worldpay reports refunds and chargebacks as negative values.
            #    Normalise to positive magnitudes so all amounts are unsigned.
            df["refunded"] = df["refunded"].apply(abs)
            df["chargeback"] = df["chargeback"].apply(abs)

            # 6. Unpivot the three amount columns into typed rows to match the
            #    Adyen schema: one row per type with net_credit / net_debit.
            #
            #    Worldpay has no chargeback reversal in this report — those rows
            #    simply won't appear, which is consistent with Adyen where
            #    chargeback_reversal rows are only present when they occur.
            #
            #    type        net_credit         net_debit
            #    settled     deposit amount     0
            #    refunded    0                  refund amount
            #    chargeback  0                  chargeback amount
            rows = []

            settled = df[["payment_type", "settled"]].copy()
            settled["type"] = "settled"
            settled["net_credit"] = settled["settled"]
            settled["net_debit"] = Decimal("0")
            settled = settled.drop(columns=["settled"])
            rows.append(settled)

            refunded = df[["payment_type", "refunded"]].copy()
            refunded["type"] = "refunded"
            refunded["net_credit"] = Decimal("0")
            refunded["net_debit"] = refunded["refunded"]
            refunded = refunded.drop(columns=["refunded"])
            rows.append(refunded)

            chargeback = df[["payment_type", "chargeback"]].copy()
            chargeback["type"] = "chargeback"
            chargeback["net_credit"] = Decimal("0")
            chargeback["net_debit"] = chargeback["chargeback"]
            chargeback = chargeback.drop(columns=["chargeback"])
            rows.append(chargeback)

            df = pd.concat(rows, ignore_index=True)

            # 7. Drop zero rows — if a batch has no chargebacks, no point writing them
            df = df[(df["net_credit"] != 0) | (df["net_debit"] != 0)]

            if df.empty:
                continue

            output_path = f"s3://{clean_bucket}/acquirer=worldpay/batch_{i}.parquet"

            # 8. Write highly compressed Parquet
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
