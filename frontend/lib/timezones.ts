export type TimezoneOption = {
  value: string;
  label: string;
  searchText: string;
};

const TIMEZONE_LABELS: Record<string, string> = {
  "Asia/Colombo": "Sri Lanka - Colombo",
  "Asia/Dubai": "United Arab Emirates - Dubai",
  "Asia/Kolkata": "India - Kolkata",
  "Asia/Karachi": "Pakistan - Karachi",
  "Asia/Singapore": "Singapore",
  "Asia/Tokyo": "Japan - Tokyo",
  "Asia/Seoul": "South Korea - Seoul",
  "Asia/Bangkok": "Thailand - Bangkok",
  "Asia/Jakarta": "Indonesia - Jakarta",
  "Asia/Kuala_Lumpur": "Malaysia - Kuala Lumpur",
  "Asia/Hong_Kong": "Hong Kong",
  "Asia/Shanghai": "China - Shanghai",
  "Asia/Manila": "Philippines - Manila",
  "Asia/Kathmandu": "Nepal - Kathmandu",
  "Asia/Dhaka": "Bangladesh - Dhaka",
  "Europe/London": "United Kingdom - London",
  "Europe/Paris": "France - Paris",
  "Europe/Berlin": "Germany - Berlin",
  "Europe/Amsterdam": "Netherlands - Amsterdam",
  "Europe/Madrid": "Spain - Madrid",
  "Europe/Rome": "Italy - Rome",
  "Europe/Zurich": "Switzerland - Zurich",
  "Europe/Stockholm": "Sweden - Stockholm",
  "Europe/Moscow": "Russia - Moscow",
  "Africa/Johannesburg": "South Africa - Johannesburg",
  "Africa/Nairobi": "Kenya - Nairobi",
  "Africa/Cairo": "Egypt - Cairo",
  "Australia/Sydney": "Australia - Sydney",
  "Australia/Melbourne": "Australia - Melbourne",
  "Australia/Perth": "Australia - Perth",
  "Pacific/Auckland": "New Zealand - Auckland",
  "America/New_York": "United States - New York",
  "America/Chicago": "United States - Chicago",
  "America/Denver": "United States - Denver",
  "America/Los_Angeles": "United States - Los Angeles",
  "America/Toronto": "Canada - Toronto",
  "America/Vancouver": "Canada - Vancouver",
  "America/Sao_Paulo": "Brazil - Sao Paulo",
  "America/Mexico_City": "Mexico - Mexico City",
  "America/Bogota": "Colombia - Bogota",
};

function fallbackLabel(value: string) {
  return value.replace(/\//g, " - ").replace(/_/g, " ");
}

export function getTimezoneOptions(): TimezoneOption[] {
  const supportedValues =
    typeof Intl !== "undefined" && "supportedValuesOf" in Intl
      ? Intl.supportedValuesOf("timeZone")
      : Object.keys(TIMEZONE_LABELS);

  return supportedValues
    .map((value) => {
      const label = TIMEZONE_LABELS[value] ?? fallbackLabel(value);
      return {
        value,
        label,
        searchText: `${label} ${value}`.toLowerCase(),
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label));
}
