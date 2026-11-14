# Canonical Order Lifecycle Contract

## Status Definitions
- `CREATED`: Order submitted.
- `ASSIGNED`: Store/Rider assigned.
- `ACCEPTED`: Assignment accepted.
- `PREPARING`: Preparation in progress.
- `READY`: Ready for pickup.
- `OUT_FOR_DELIVERY`: Transit.
- `DELIVERED`: Complete.
- `CANCELLED`: Cancelled.

## API Contracts
- `POST /v1/orders`: Accepts `{ kind, items: [{medicineId, quantity}], prescriptionId }`.
- `GET /v1/orders`: Returns list of orders with `status`, `prescriptionAction`, and `updatedAt`.
