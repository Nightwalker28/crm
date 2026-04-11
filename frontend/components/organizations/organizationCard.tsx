import { Organization } from "@/hooks/sales/useOrganizations";
import { Globe, Mail, Phone } from "lucide-react";

export default function OrganizationCard({
  org,
}: {
  org: Organization;
}) {
  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900 p-4 hover:border-zinc-700 transition">
      <h2 className="text-lg font-medium mb-1">
        {org.org_name}
      </h2>

      {org.industry && (
        <p className="text-sm text-zinc-400 mb-3">
          {org.industry}
        </p>
      )}

      <div className="space-y-2 text-sm text-zinc-300">
        {org.primary_email && (
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4 text-zinc-400" />
            <span>{org.primary_email}</span>
          </div>
        )}

        {org.primary_phone && (
          <div className="flex items-center gap-2">
            <Phone className="w-4 h-4 text-zinc-400" />
            <span>{org.primary_phone}</span>
          </div>
        )}

        {org.website && (
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-zinc-400" />
            <a
              href={org.website}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:underline"
            >
              {org.website.replace("https://", "")}
            </a>
          </div>
        )}
      </div>

      {org.annual_revenue && (
        <div className="mt-3 text-xs text-zinc-500">
          Revenue: {org.annual_revenue}
        </div>
      )}
    </div>
  );
}