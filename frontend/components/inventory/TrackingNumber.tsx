import { TextLink } from "@/components/ui/TextLink";

/**
 * Carriers whose public tracking page takes the number in the URL (13a I4). The carrier is
 * free text on a delivery, so it is matched loosely; an unknown carrier shows the number as
 * text rather than guessing a link.
 */
const CARRIER_TRACKING_URLS: Array<{ match: RegExp; url: (number: string) => string }> = [
  { match: /\bdhl\b/i, url: (number) => `https://www.dhl.com/global-en/home/tracking/tracking-express.html?tracking-id=${number}` },
  { match: /\bfed\s?ex\b/i, url: (number) => `https://www.fedex.com/fedextrack/?trknbr=${number}` },
  { match: /\bups\b/i, url: (number) => `https://www.ups.com/track?tracknum=${number}` },
  { match: /\busps\b/i, url: (number) => `https://tools.usps.com/go/TrackConfirmAction?tLabels=${number}` },
  { match: /\baramex\b/i, url: (number) => `https://www.aramex.com/track/results?ShipmentNumber=${number}` },
];

export function trackingUrl(carrier: string | null | undefined, number: string): string | null {
  if (!carrier) return null;
  const known = CARRIER_TRACKING_URLS.find((entry) => entry.match.test(carrier));
  return known ? known.url(encodeURIComponent(number.trim())) : null;
}

/** A delivery's tracking number, linked to the carrier's tracking page where it is known. */
export function TrackingNumber({ carrier, number }: { carrier: string | null | undefined; number: string }) {
  const href = trackingUrl(carrier, number);
  if (!href) return <span className="tabular-nums">{number}</span>;
  return (
    <TextLink href={href} external className="tabular-nums">
      {number}
    </TextLink>
  );
}
