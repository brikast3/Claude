# crypto-arb-scanner

A single self-contained HTML file that scans for crypto arbitrage
opportunities live, entirely in your browser. No Python, no install, no
server — open the file, click Start, watch it work.

## Why a browser file instead of a script

Two constraints shaped this:

1. You didn't want anything involving Python.
2. This can't be published as a Claude Artifact either — Artifacts run in a
   sandboxed iframe whose Content-Security-Policy blocks `fetch`/XHR to
   arbitrary external hosts, so it couldn't actually call exchange APIs.

A plain `.html` file opened directly in your own browser has neither
restriction: it's just a webpage making normal requests, like any other site
you visit. Every request goes straight from your machine to the exchange —
nothing passes through me or any server of mine.

## What it does

- Polls **6 exchanges' public market data** (no API key needed) for
  BTC/USDT, ETH/USDT, SOL/USDT: Binance, Kraken, Coinbase, Bybit, KuCoin,
  Bitstamp.
- **Cross-exchange check**: for every pair of exchanges, computes the net
  return of buying on one and selling on the other, after both exchanges'
  taker fees.
- **Triangular check**: on exchanges with a direct BTC-quoted ETH pair
  (Binance, Bybit, KuCoin), computes USDT→BTC→ETH→USDT and the reverse path,
  after three legs of fees. This avoids the cross-exchange fund-transfer
  problem entirely (everything happens on one exchange).
- Logs anything above your threshold with a timestamp, and tracks how many
  **consecutive polls** the same opportunity kept showing up in — a cheap
  proxy for "was this real and lasting, or a one-off data glitch."
- Export button dumps the full log as JSON so you can send it back for an
  honest read.

## What it does NOT prove

Read this before believing any number the page shows you:

- **Top-of-book only.** The bid/ask shown is for whatever size sits at the
  very best price. Trade more than that and you eat into worse prices
  (slippage) that this page never sees.
- **No execution latency modeled.** By the time you'd actually place an
  order, the price you saw may be gone — especially against bots already
  watching the same spread at machine speed.
- **Cross-exchange arbitrage needs funds already sitting on both
  exchanges.** If you have to transfer between them first, that takes
  minutes and the price can move against you before you're able to sell.
  Triangular arbitrage (single exchange) doesn't have this problem, but
  still has the first two problems above.
- **Fees are editable defaults, not your real fees.** Actual taker fees
  depend on your account's 30-day volume tier and any native-token discount
  (BNB on Binance, etc.) — check your own exchange account and update the
  fee inputs before trusting any edge number.
- **CORS support varies and can change.** If an exchange shows
  "BLOCKED / ERROR" in the status table, that exchange's public API isn't
  reachable from a browser tab right now — the rest keep working
  independently.

A logged "opportunity" is a lead worth a closer look, not proof you could
have captured it. This is the same discipline as `football-quant` in this
repo: measure honestly before believing you have an edge.

## Usage

1. Download `scanner.html` (or open it if you already have the file).
2. Double-click to open it in your browser. No install, no server.
3. Optionally edit the taker fee fields to match your real account tier.
4. Click **Start scanning**. Leave it running for at least 15-30 minutes for
   the "consecutive polls" numbers to mean anything.
5. Click **Export log as JSON** and send the file back for an honest read on
   what it actually found.

## Extending

- Add more exchanges by following the `EXCHANGES` object's shape in the
  `<script>` block (symbol name per pair + a fetcher function that returns
  `{bid, ask}`).
- Add more triangular paths/exchanges via the `TRI_PATHS` object the same
  way — any exchange with a direct pair between two non-USDT assets works.
- Everything is vanilla JS in one file on purpose — no build step, no
  dependency to go stale.
