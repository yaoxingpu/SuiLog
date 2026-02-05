# SuiLog Frontend

Encrypted diary dApp built with Vue 3 + Vite.

## Quick start

```bash
npm install
cp .env.example .env
npm run dev
```

## Environment

Edit `.env` with your deployment values:

```
VITE_SUI_NETWORK=testnet
VITE_SUILOG_PACKAGE_ID=0xYOUR_PACKAGE_ID
VITE_WALRUS_AGGREGATOR=https://aggregator.walrus-testnet.walrus.space
VITE_WALRUS_PUBLISHER=https://publisher.walrus-testnet.walrus.space
```

## Notes

- The vault password is stored only on the client (localStorage). If you reset it, old entries become unreadable.
- Share links encrypt a one-time key with a separate password and can expire automatically.
