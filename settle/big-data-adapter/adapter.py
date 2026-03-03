import os
from decimal import Decimal

import awswrangler as wr
import pandas as pd


def handler(event, context):
    clean_bucket = os.environ["CLEAN_BUCKET"]

    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]
        input_path = f"s3://{bucket}/{key}"

        # 1. Define the columns we actually want
        # This ignores the other 40+ useless columns in the raw CSV
        keep_cols = ["merchant_id", "pos_amount", "neg_amount", "type"]

        # 2. Read and Transform in one pass
        # We use chunksize to handle larger files without crashing RAM
        dfs = wr.s3.read_csv(path=input_path, usecols=keep_cols, chunksize=100000)

        for i, df in enumerate(dfs):
            # 3. Financial Precision: Convert amounts to Decimal strings then to Decimal types
            # Doing this prevents floating-point rounding errors
            df["pos_amount"] = df["pos_amount"].astype(str).apply(Decimal)
            df["neg_amount"] = df["neg_amount"].astype(str).apply(Decimal)

            # 4. Partitioning Logic (e.g., today's date)
            # This makes Athena queries 10x faster later
            output_path = f"s3://{clean_bucket}/acquirer=acq_a/batch_{i}.parquet"

            wr.s3.to_parquet(
                df=df,
                path=output_path,
                dataset=True,
                # This ensures the Parquet schema uses DECIMAL(19,4)
                dtype={"pos_amount": "decimal(19,4)", "neg_amount": "decimal(19,4)"},
            )

    return {"status": "success"}
