"""Per-order status machine (Part 6.2). FAILED_* and NEEDS_REVIEW are side states."""
QUEUED, FETCHING, FETCHED = "QUEUED", "FETCHING", "FETCHED"
EXTRACTING, EXTRACTED, ANALYSED, READY = "EXTRACTING", "EXTRACTED", "ANALYSED", "READY"
FAILED_FETCH, FAILED_EXTRACT, NEEDS_REVIEW = "FAILED_FETCH", "FAILED_EXTRACT", "NEEDS_REVIEW"
PENDING_IDENTITY = "PENDING_IDENTITY"

ALLOWED = {
    QUEUED: {FETCHING},
    FETCHING: {FETCHED, QUEUED, FAILED_FETCH},  # QUEUED = scheduled retry or stuck-job recovery
    FETCHED: {EXTRACTING},
    EXTRACTING: {EXTRACTED, FAILED_EXTRACT, NEEDS_REVIEW},
    EXTRACTED: {ANALYSED, NEEDS_REVIEW},
    ANALYSED: {READY, PENDING_IDENTITY},
    PENDING_IDENTITY: {READY},  # a person decided same/different patient
    NEEDS_REVIEW: {EXTRACTED},
    FAILED_FETCH: {QUEUED},  # manual Retry
    FAILED_EXTRACT: {FETCHED, EXTRACTING},  # manual Retry
    READY: set(),
}


def move(order, to: str) -> None:
    if to not in ALLOWED.get(order.status, set()):
        raise ValueError(f"Illegal order status change {order.status} -> {to}")
    order.status = to
