export const SUI_NETWORK = (import.meta.env.VITE_SUI_NETWORK ?? "testnet") as string
const DEFAULT_PACKAGE_ID = "0x030a26b41c7c1f1c526d31a2eada98a981d659115a2bfcd3fc850b6262e2060c"
export const SUI_PACKAGE_ID = import.meta.env.VITE_SUILOG_PACKAGE_ID ?? DEFAULT_PACKAGE_ID
const LEGACY_RAW = import.meta.env.VITE_SUILOG_PACKAGE_IDS ?? ""
const LEGACY_LIST = LEGACY_RAW.split(",").map(item => item.trim()).filter(Boolean)
export const SUI_PACKAGE_IDS = Array.from(
  new Set([SUI_PACKAGE_ID, DEFAULT_PACKAGE_ID, ...LEGACY_LIST])
)

export const WALRUS_AGGREGATOR =
  import.meta.env.VITE_WALRUS_AGGREGATOR ?? "https://aggregator.walrus-testnet.walrus.space"
export const WALRUS_PUBLISHER =
  import.meta.env.VITE_WALRUS_PUBLISHER ?? "https://publisher.walrus-testnet.walrus.space"
