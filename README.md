# Candle Quest

A browser game that teaches trading by having you trade simulated markets. Every round is graded on **process** (stops, position size, risk/reward, discipline), not just profit, because a good decision can lose and a bad one can win.

No install, no build, no network. Open `index.html` in a browser, or serve the folder:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Progress (XP, stars, badges, trade journal) is saved in your browser's `localStorage`.

## How a level works

1. **Learn**: a short concept card with an illustration and one rule to remember.
2. **Practise**: a quiz or a live trading round on a market built to show that concept.
3. **Debrief**: a scorecard of 3 stars, your stats, equity curve, every trade with flags (`no stop`, `revenge`, `FOMO`…), and one takeaway. Earn 2 stars to unlock the next level.

## Curriculum

| # | Level | What you practise |
|---|-------|-------------------|
| 1 | Reading Candles | OHLC, bodies, wicks; tap the doji, hammer, shooting star |
| 2 | Trends & Levels | Call the trend; drag support/resistance lines onto the chart |
| 3 | Your First Trade | Long/short, market vs limit orders, the bid/ask spread |
| 4 | Stop-Losses | Trade a calm uptrend that suddenly drops 13% |
| 5 | Position Sizing | Sizing quiz, then size trades by % risk (the 1–2% rule) |
| 6 | Risk / Reward | Take-profit targets, R-multiples, stop to breakeven |
| 7 | Indicators | MA20/MA50 crossovers and RSI, called out live by the coach |
| 8 | Mind Games | News, hype, fake breakouts and a FOMO prompt. Tests discipline |

After Level 3: **Daily challenge** (same seeded market for everyone each day) and **Endless Market** (random regimes). Later levels unlock **Scenario replays**: Flash Crash, Pump & Dump, Chop Zone.

## Controls

- Drag the dashed lines on the chart to set stop, target and limit price.
- `Space` play/pause · `Enter` place order · `X` close position · speed 1×–8×.

## Code

- `index.html`: screens and markup
- `style.css`: theme tokens (dark and light), layout
- `game.js`: everything else, in sections: seeded RNG and market generator (waypoints joined by Brownian bridges), indicators, canvas chart, lesson illustrations, level data, quiz engine, broker/trade engine, debrief, profile, achievements

The markets are simulated and the tickers are fictional. This is an educational game, not financial advice.
