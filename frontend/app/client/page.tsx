"use client";

import { formatSnakeCaseLabel } from "@/lib/module-display";
import Link from "next/link";
import { ArrowRight } from "lucide-react";

import { Card } from "@/components/ui/Card";
import { EmptyState } from "@/components/ui/EmptyState";
import { Fact, FactList } from "@/components/ui/Fact";
import { ListRow, RowList } from "@/components/ui/ListRow";
import { PageShell } from "@/components/ui/PageShell";
import { PanelHeader } from "@/components/ui/PanelStates";
import { SectionHeading } from "@/components/ui/SectionHeading";
import { StatTile } from "@/components/ui/StatTile";
import { useClientOverview, type ClientMe } from "@/hooks/useClientPortal";
import { CLIENT_PORTAL_SECTIONS } from "@/lib/client-portal-nav";
import { formatDateTime } from "@/lib/datetime";

function customerName(profile: ClientMe) {
  return profile.organization_name || profile.contact_name || profile.email;
}

export default function ClientPortalHomePage() {
  const overviewQuery = useClientOverview();
  const overview = overviewQuery.data;
  const profile = overview?.account;
  const nextActions = overview?.next_actions ?? [];

  return (
    <PageShell
      eyebrow="Client portal"
      title={profile ? customerName(profile) : "Client portal"}
      description={profile?.email}
      isLoading={overviewQuery.isLoading}
      hasError={Boolean(overviewQuery.error)}
      // Ruling 5 — a portal state that points at `/dashboard` is a customer looking at a
      // login wall. `PageShell`'s default back target is the operator's.
      backHref="/client"
      backLabel="Return to the portal"
      errorDescription="Sign in again, or check your connection and try again."
      onRetry={() => overviewQuery.refetch()}
    >
      <section className="flex flex-col gap-4">
        <SectionHeading as="h2">Your account</SectionHeading>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {CLIENT_PORTAL_SECTIONS.map((section) => {
            const Icon = section.icon;
            const metric = overview?.metrics.find((item) => item.key === section.key);
            return (
              // A tile that is also a link earns its box by being clickable (R8, and 5.7
              // ruling 1's one exception) — it holds a `StatTile` rather than the primitive
              // growing an `href`.
              <Card key={section.key} variant="interactive" asChild>
                <Link
                  href={section.href}
                  className="flex h-full flex-col p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                >
                  <StatTile
                    label={
                      <span className="inline-flex items-center gap-2">
                        <Icon className="size-4 text-copy-muted" aria-hidden="true" />
                        {section.label}
                      </span>
                    }
                    value={metric?.value ?? 0}
                  />
                  <span className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-copy-secondary">
                    Open {section.label.toLocaleLowerCase()}
                    <ArrowRight className="size-4" aria-hidden="true" />
                  </span>
                </Link>
              </Card>
            );
          })}
        </div>
      </section>

      {profile ? (
        <Card className="p-4">
          <FactList>
            <Fact label="Your prices">{profile.customer_group?.name ?? "Standard prices"}</Fact>
            <Fact label="About your prices">
              {profile.customer_group?.description ?? "The prices you see in the catalog are the ones we charge you."}
            </Fact>
          </FactList>
        </Card>
      ) : null}

      <Card className="flex flex-col gap-4 p-4">
        <PanelHeader
          title="Next actions"
          description="What is waiting on you, and what is on its way."
        />
        {nextActions.length === 0 ? (
          <EmptyState
            title="Nothing needs your attention"
            description="Quotes to review and orders in progress will appear here."
          />
        ) : (
          <RowList label="Next actions" inset>
            {nextActions.map((action) => (
              <ListRow
                key={action.key}
                title={action.label}
                href={action.href}
                meta={
                  <>
                    {action.status ? <span>{formatSnakeCaseLabel(action.status)}</span> : null}
                    {action.created_at ? <span>{formatDateTime(action.created_at)}</span> : null}
                  </>
                }
              >
                {action.description ?? null}
              </ListRow>
            ))}
          </RowList>
        )}
      </Card>
    </PageShell>
  );
}
