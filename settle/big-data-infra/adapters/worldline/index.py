import os
import io
import boto3
import pandas as pd
from decimal import Decimal
import awswrangler as wr  # type: ignore

s3 = boto3.client("s3")

# Worldline Type values we care about
RELEVANT_TYPES = {"PURCHASE", "REFUND", "CHARGEBACK"}

def handler(event, context):
    clean_bucket = os.environ["CLEAN_BUCKET"]

    for record in event["Records"]:
        bucket = record["s3"]["bucket"]["name"]
        key = record["s3"]["object"]["key"]

        # 1. Read the raw file from S3
        response = s3.get_object(Bucket=bucket, Key=key)
        raw_content = response["Body"].read().decode("utf-8")

        # 2. Worldline files have blocks: FILE_HEADER, TRANSACTION_RECORDS, FILE_TRAILER
        # We need to extract just the TRANSACTION_RECORDS block
        lines = raw_content.splitlines()
        
        try:
            start_idx = lines.index("TRANSACTION_RECORDS") + 1
            end_idx = lines.index("FILE_TRAILER") if "FILE_TRAILER" in lines else len(lines)
        except ValueError:
            # If the markers aren't found, assume it's just a raw CSV
            start_idx = 0
            end_idx = len(lines)

        csv_data = "\n".join(lines[start_idx:end_idx])
        if not csv_data.strip():
            continue

        # 3. Read into pandas DataFrame
        df = pd.read_csv(io.StringIO(csv_data), sep=";")

        # Keep only relevant columns if they exist
        use_cols = ["MERCHANT_ID", "CARD_SCHEME", "TXN_TYPE", "TXN_AMOUNT"]
        # Filter columns to only those present in the dataframe
        available_cols = [col for col in use_cols if col in df.columns]
        df = df[available_cols]

        # 4. Keep only relevant transaction types
        if "TXN_TYPE" in df.columns:
            df = df[df["TXN_TYPE"].isin(RELEVANT_TYPES)].copy()

        if df.empty:
            continue

        # 5. Map to clean_zone vocabulary
        df = df.rename(
            columns={
                "MERCHANT_ID": "merchant_id",
                "CARD_SCHEME": "payment_type",
            }
        )

        df["type"] = df["TXN_TYPE"].map(
            {
                "PURCHASE": "settled",
                "REFUND": "refunded",
                "CHARGEBACK": "chargeback",
            }
        )

        # 6. Calculate net_credit and net_debit from TXN_AMOUNT
        # In Worldline, Refunds and Chargebacks are negative TXN_AMOUNT
        def get_credit(row):
            if row["TXN_TYPE"] == "PURCHASE":
                return str(abs(float(row["TXN_AMOUNT"])))
            return "0"

        def get_debit(row):
            if row["TXN_TYPE"] in ["REFUND", "CHARGEBACK"]:
                return str(abs(float(row["TXN_AMOUNT"])))
            return "0"

        df["net_credit"] = df.apply(get_credit, axis=1).apply(Decimal)
        df["net_debit"] = df.apply(get_debit, axis=1).apply(Decimal)

        # Drop the original columns that aren't needed anymore
        df = df[["merchant_id", "payment_type", "type", "net_credit", "net_debit"]]

        output_path = f"s3://{clean_bucket}/acquirer=worldline/{key.split('/')[-1]}.parquet"

        # 7. Write highly compressed Parquet
        wr.s3.to_parquet(
            df=df,
            path=output_path,
            dataset=True,
            dtype={
                "merchant_id": "string",
                "net_credit": "decimal(19,4)",
                "net_debit": "decimal(19,4)",
            },
        )

    return {"status": "success"}
