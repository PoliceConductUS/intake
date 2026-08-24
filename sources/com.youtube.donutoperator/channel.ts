/**
 * Pinned identity for the Donut Operator channel.
 *
 * The channel ID is the identity. The handle (`@DonutOperator`) and the display
 * name are labels a channel owner can change at will, so they are recorded as
 * provenance and checked for drift — never used to resolve which channel this
 * source ingests.
 */
export const CHANNEL_ID = "UCwkm_Wcyh0pc7UUmZZfL-6w";
export const CHANNEL_HANDLE = "@DonutOperator";
export const CHANNEL_URL = "https://www.youtube.com/@DonutOperator";
export const CHANNEL_DISPLAY_NAME = "Donut Operator";

/**
 * Board-provided rank in the subscriber-ordered intake-source queue, with the
 * subscriber count that produced it. YouTube reports subscriber counts rounded
 * to three significant figures, so this is a snapshot for ordering evidence,
 * not a measured value.
 */
export const SUBSCRIBER_SNAPSHOT = {
  rank: 1,
  subscriberCount: 5_310_000,
  retrievedOn: "2026-08-24",
} as const;

export function watchUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}
