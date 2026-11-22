# Website API portfolio price history

`GET /api/v1/website/portfolio-prices` accepts the canonical `offer_reference`
from the website catalogue. The API checks the requested publication within the
authenticated company before returning its portfolio or mixed-contract prices.

If you pass `price_area`, the history contains up to the latest 48 eligible
monthly prices for that area. Without `price_area`, it contains up to 48 rows
across all areas. Eligible rows have a price, are current and have status `final`
or `locked`. The API returns the selected rows in ascending month and price-area
order. It returns an empty history when the publication hides historical prices
or no eligible rows exist. The amount is expressed in öre/kWh, excluding VAT.
