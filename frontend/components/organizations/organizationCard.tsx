import { Organization } from "@/hooks/sales/useOrganizations";
import { Building2, Globe, Mail, Phone } from "lucide-react";

export default function OrganizationCard({
  org,
}: {
  org: Organization;
}) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-linear-to-b from-zinc-900 to-zinc-950 p-4 hover:border-zinc-700 transition">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium mb-1 text-zinc-100">
            {org.org_name}
          </h2>

          {org.industry && (
            <p className="text-sm text-zinc-400 mb-3">
              {org.industry}
            </p>
          )}
        </div>

        <div className="rounded-lg border border-zinc-800 bg-zinc-950/70 p-2 text-zinc-500">
          <Building2 className="w-4 h-4" />
        </div>
      </div>

      <div className="space-y-2 text-sm text-zinc-300 min-h-16">
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
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-950/70 px-3 py-2 text-xs text-zinc-500">
          Revenue: {org.annual_revenue}
        </div>
      )}
    </div>
  );
}
