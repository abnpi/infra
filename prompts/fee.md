
we have defined the fee example
we have defined the contract in settle DB
what we don't have is the way of retrieving the fees from the lifecycle DB. (for now we will mock the coming object)
 
We have two types of fees. flat fees and transactional fees(fees which are appied per transaction)
As per flat fee - the fee object is essentially a rule how to apply the flat fee. it contains information when the fee is applicable.
and which currency it is denominated which will reflect which inbound account it will be applied to.
settle module will have to check if the chargable fee was already applied (monthly fee will be chargable of e.g. 8th of each month) and if not it will be applied.
this information per merchant can be retrieved from the transaction ledger DB where the payment reference will be the product(fee) id.

As per fees per transation (payment type. e.g. visa, mastercard etc)
the rule also comes from the fee object. usually it will be a combination of charges, flat fee, percentage or both, or there might be some tresholds applicable.

What we need to do with this fee object is run the athena query on the parquet files to apply the fee per merchant. The parquet file is already present from the ingestion part and calculation of totals for merchant.

the output of the fee calculation will be the csv object - fees per merchant and this csv will be dropped into s3 bucket (alternatively it could be pushed to sqs since the fee object should be small enough).

the output should be the mapped to original fee object on one to one relationship (not all fees will be applied, if the fee is not applicable it should be indicated that it is not applicable). if the fee is applicabe it should contain the currency, reference to product, value, date, and perhaps metadata when it comes to fees per transaction - how many transactions of each type were there. 

