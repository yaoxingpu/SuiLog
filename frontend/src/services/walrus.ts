import { WALRUS_AGGREGATOR, WALRUS_PUBLISHER } from "./config";

export class WalrusService {
  static getPublicUrl(blobId: string): string {
    return `${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`
  }

  static async uploadBlob(
    data: Uint8Array | Blob,
    options?: {
      epochs?: number
    }
  ): Promise<string> {
    const params = new URLSearchParams()
    if (options?.epochs) {
      params.set("epochs", String(options.epochs))
    }
    const query = params.toString()
    const blobUrl = query ? `${WALRUS_PUBLISHER}/v1/blobs?${query}` : `${WALRUS_PUBLISHER}/v1/blobs`
    const storeUrl = query ? `${WALRUS_PUBLISHER}/v1/store?${query}` : `${WALRUS_PUBLISHER}/v1/store`

    let response = await fetch(blobUrl, {
      method: "PUT",
      body: data as any
    });

    if (response.status === 404) {
      response = await fetch(storeUrl, {
        method: "PUT",
        body: data as any
      });
    }

    if (!response.ok) {
      throw new Error("Failed to upload to Walrus");
    }

    const result = await response.json();

    let blobId = "";
    if (result.newlyCreated) {
        blobId = result.newlyCreated.blobObject.blobId;
    } else if (result.alreadyCertified) {
        blobId = result.alreadyCertified.blobId;
    } else {
        throw new Error("Unexpected Walrus response: " + JSON.stringify(result));
    }
    return blobId;
  }

  static async getBlob(blobId: string): Promise<Blob> {
    let response = await fetch(`${WALRUS_AGGREGATOR}/v1/blobs/${blobId}`);
    if (response.status === 404) {
      response = await fetch(`${WALRUS_AGGREGATOR}/v1/${blobId}`);
    }
    if (!response.ok) throw new Error("Failed to fetch blob");
    return await response.blob();
  }
}
