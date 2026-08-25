# Production navigation evidence

On production deployment `dpl_GyfJvxCX21wwsqvFzncueqY8NVkh`, runtime logs around 2026-08-25T20:48:49Z–20:48:51Z showed concurrent cache-miss requests for many visible admin sidebar destinations, including customers, operations/switches, metering, contracts, Ediel control tower, outbound missing meter values, customer-info requests, website applications, and Ediel. This is consistent with automatic viewport Link prefetch creating a burst of authenticated dynamic route work.
