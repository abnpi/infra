# Settle Database Schema

This folder contains the Prisma schema for the Settle virtual account system.

## Setup

1. Install dependencies:
   ```bash
   cd database
   npm install
   ```

2. Copy environment file:
   ```bash
   cp .env.example .env
   ```

3. Update `.env` with your PostgreSQL connection string from the RDS instance.

## Models

- **AccountOwner**: Represents either a Merchant or Infinite as account owners
- **VirtualAccount**: Container for funds with running balance per account owner, type, and currency
- **LedgerEntry**: Immutable audit trail for all fund movements (double-entry accounting)
- **SettlementRequest**: Tracks final bank transfer instructions
- **VirtualAccountType**: Enum defining account buckets (MERCHANT_INBOUND, MERCHANT_FEES, etc.)

## Usage

- Generate Prisma client: `npm run db:generate`
- Push schema to database: `npm run db:push`
- Open Prisma Studio: `npm run db:studio`

## Architecture Notes

- Uses double-entry accounting with immutable ledger entries
- Decimal precision (19,4) for financial accuracy
- Unique constraints prevent duplicate virtual accounts
- Supports both merchant and Infinite account ownership
