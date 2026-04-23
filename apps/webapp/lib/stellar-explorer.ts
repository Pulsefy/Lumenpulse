export const getStellarExplorerUrl = (
  type: "tx" | "account" | "asset" | "ledger",
  identifier: string,
  network: "testnet" | "public" = "testnet"
): string => {
  const baseUrl =
    network === "testnet"
      ? "https://stellar.expert/explorer/testnet"
      : "https://stellar.expert/explorer/public";

  return `${baseUrl}/${type}/${identifier}`;
};

export const openInExplorer = (
  type: "tx" | "account" | "asset" | "ledger",
  identifier: string,
  network: "testnet" | "public" = "testnet"
): void => {
  const url = getStellarExplorerUrl(type, identifier, network);
  window.open(url, "_blank", "noopener,noreferrer");
};
