"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/Card";
import { ColumnPicker } from "@/components/ui/ColumnPicker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/PageHeader";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useModuleCustomFields } from "@/hooks/useModuleCustomFields";
import { useSavedViews } from "@/hooks/useSavedViews";
import { SavedViewConditionEditor } from "@/components/ui/SavedViewConditionEditor";
import { buildModuleViewDefinition, CUSTOM_FIELD_SUPPORTED_MODULES } from "@/lib/moduleViewConfigs";

export default function ManageModuleViewPage() {
  const params = useParams<{ moduleKey: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const moduleKey = params.moduleKey;
  const { data: customFields = [] } = useModuleCustomFields(
    moduleKey,
    CUSTOM_FIELD_SUPPORTED_MODULES.has(moduleKey),
  );
  const definition = useMemo(
    () => buildModuleViewDefinition(moduleKey, customFields),
    [customFields, moduleKey],
  );
  const safeDefinition = definition ?? {
    key: moduleKey,
    label: "Module",
    route: "/dashboard",
    columns: [],
    filterFields: [],
    defaultConfig: { visible_columns: [], filters: { search: "", logic: "all", conditions: [], all_conditions: [], any_conditions: [] }, sort: null },
  };
  const requestedViewId = searchParams.get("viewId") ?? "system-default";

  const [viewName, setViewName] = useState("");

  const {
    views,
    selectedView,
    selectedViewId,
    setSelectedViewId,
    draftConfig,
    setDraftConfig,
    createViewWithConfig,
    updateView,
    setCurrentAsDefault,
    deleteCurrentView,
    isSaving,
  } = useSavedViews(moduleKey, safeDefinition.defaultConfig);

  useEffect(() => {
    if (requestedViewId === "system-default" && selectedView?.is_system) {
      return;
    }
    if (selectedViewId !== requestedViewId) {
      setSelectedViewId(requestedViewId);
    }
  }, [requestedViewId, selectedView, selectedViewId, setSelectedViewId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setViewName(selectedView && !selectedView.is_system ? selectedView.name : "");
  }, [selectedView]);

  if (!definition) {
    return (
      <div className="mx-auto max-w-4xl">
        <Card className="px-6 py-6 text-neutral-200">Unsupported module view.</Card>
      </div>
    );
  }

  const filterFields = safeDefinition.filterFields;
  const visibleColumns = draftConfig.visible_columns?.length ? draftConfig.visible_columns : safeDefinition.defaultConfig.visible_columns;
  async function handleSave() {
    if (!selectedView) return;
    if (selectedView.id == null) return;

    await updateView(selectedView.id, {
      name: viewName.trim() || selectedView.name,
      config: draftConfig,
    });
    toast.success("Saved view updated.");
  }

  async function handleSaveAsNew() {
    if (!viewName.trim()) {
      toast.error("View name is required.");
      return;
    }
    const created = await createViewWithConfig({
      name: viewName.trim(),
      config: draftConfig,
    });
    toast.success("Saved view created.");
    router.replace(`/dashboard/views/${moduleKey}?viewId=${created.id}`);
  }

  async function handleSetDefault() {
    if (!selectedView || selectedView.id == null) {
      toast.error("Create or select a personal view first.");
      return;
    }
    await setCurrentAsDefault();
    toast.success("Default view updated.");
  }

  async function handleDelete() {
    if (!selectedView || selectedView.id == null) return;
    if (!window.confirm(`Delete the view "${selectedView.name}"?`)) return;
    await deleteCurrentView();
    toast.success("Saved view deleted.");
    router.replace(`/dashboard/views/${moduleKey}?viewId=system-default`);
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-6">
      <PageHeader
        title={`Manage ${definition.label} View`}
        description="Define columns, default search, and shared AND/OR filter conditions for this module view."
        actions={
          <>
            <Button asChild type="button" variant="ghost" size="sm">
              <Link href={definition.route}>
                <ArrowLeft className="h-4 w-4" />
                Back to {definition.label}
              </Link>
            </Button>
            <Select value={selectedViewId} onValueChange={(value) => router.replace(`/dashboard/views/${moduleKey}?viewId=${value}`)}>
              <SelectTrigger className="w-64">
                <SelectValue placeholder="Select view" />
              </SelectTrigger>
              <SelectContent>
                {views.map((view) => (
                  <SelectItem key={String(view.id ?? "system-default")} value={String(view.id ?? "system-default")}>
                    {view.name}{view.is_default ? " (Default)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="button" variant="outline" onClick={() => router.replace(`/dashboard/views/${moduleKey}?viewId=system-default`)}>
              New From Default
            </Button>
          </>
        }
      />

      <Card className="px-5 py-5">
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="space-y-2">
            <Label htmlFor="view-name">View name</Label>
            <Input
              id="view-name"
              value={viewName}
              onChange={(event) => setViewName(event.target.value)}
              placeholder={selectedView?.is_system ? `New ${definition.label} view` : "View name"}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="default-search">Default search</Label>
            <Input
              id="default-search"
              value={typeof draftConfig.filters.search === "string" ? draftConfig.filters.search : ""}
              onChange={(event) =>
                setDraftConfig((current) => ({
                  ...current,
                  filters: {
                    ...current.filters,
                    search: event.target.value,
                  },
                }))
              }
              placeholder={`Search ${definition.label.toLowerCase()}`}
            />
          </div>
        </div>
      </Card>

      <Card className="px-5 py-5">
        <div>
          <h2 className="text-lg font-semibold text-neutral-100">Columns</h2>
          <p className="mt-1 text-sm text-neutral-400">Choose which columns appear in this view and the order they render.</p>
        </div>
        <div className="mt-4">
          <ColumnPicker
            title={`${definition.label} columns`}
            options={definition.columns}
            visibleColumns={visibleColumns}
            forceOpen
            onChange={(next) =>
              setDraftConfig((current) => ({
                ...current,
                visible_columns: next,
              }))
            }
          />
        </div>
      </Card>

      <SavedViewConditionEditor
        filterFields={filterFields}
        filters={draftConfig.filters}
        onChange={(nextFilters) =>
          setDraftConfig((current) => ({
            ...current,
            filters: nextFilters,
          }))
        }
        title="Conditions"
        description="Add required conditions in the AND group, optional-match conditions in the OR group, or use both together."
      />

      <div className="flex flex-wrap items-center justify-end gap-3">
        <Button type="button" variant="outline" onClick={handleSetDefault} disabled={!selectedView || selectedView.id == null || isSaving}>
          Set Default
        </Button>
        <Button type="button" variant="outline" onClick={handleDelete} disabled={!selectedView || selectedView.id == null || selectedView.is_system || isSaving}>
          Delete
        </Button>
        <Button type="button" variant="outline" onClick={() => void handleSaveAsNew()} disabled={isSaving}>
          Save As New
        </Button>
        <Button type="button" onClick={() => void handleSave()} disabled={isSaving}>
          Save Changes
        </Button>
      </div>
    </div>
  );
}
