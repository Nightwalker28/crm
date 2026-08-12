"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import type { QuickCreateOutcome } from "@/components/ui/QuickCreateSurface";
import { type ModuleFieldConfig, useModuleFieldConfigs } from "@/hooks/useModuleFieldConfigs";
import {
  useResolvedRecordLayout,
  type ResolvedRecordLayout,
} from "@/hooks/useResolvedRecordLayout";

/**
 * Typed context a contextual Quick Create passes from the record it was opened on.
 *
 * `defaults` prefills relationships the CRM already knows so the user is not asked twice.
 * None of it is authorization: the ids are re-validated server-side for tenant ownership and
 * link permission on every write.
 */
export type QuickCreateContext<TForm> = {
  sourceModuleKey?: string;
  sourceEntityId?: string | number;
  defaults?: Partial<TForm>;
  relationshipIntent?: string;
};

export type QuickCreateSubmitFailure = {
  message: string;
  /** Layout field key to focus so the user lands on the thing they have to fix. */
  focusFieldKey?: string;
};

type Options<TForm extends Record<string, unknown>> = {
  moduleKey: string;
  open: boolean;
  emptyForm: TForm;
  context?: QuickCreateContext<TForm>;
  inputId: (fieldKey: string) => string;
  validate: (args: {
    layout: ResolvedRecordLayout;
    form: TForm;
    customFieldValues: Record<string, unknown>;
  }) => Record<string, string>;
  save: (args: {
    form: TForm;
    customFieldValues: Record<string, unknown>;
    moduleFields: ModuleFieldConfig[];
  }) => Promise<number | null>;
  onCreated: (createdId: number | null, outcome: QuickCreateOutcome) => void | Promise<void>;
  describeSubmitError: (error: unknown) => QuickCreateSubmitFailure;
};

/**
 * The state machine every Quick Create surface shares: resolve the layout, hold the form and
 * its custom fields, track dirtiness against the contextual starting point, validate against
 * the resolved layout, submit once, and report failures next to the field that caused them.
 *
 * Domain concerns — which control a field renders, what the payload looks like, what a 409
 * means — stay with the module.
 */
export function useQuickCreateRecord<TForm extends Record<string, unknown>>({
  moduleKey,
  open,
  emptyForm,
  context,
  inputId,
  validate,
  save,
  onCreated,
  describeSubmitError,
}: Options<TForm>) {
  // Only fetched once the surface is opened; a list should not pay for a layout nobody asked for.
  const layoutQuery = useResolvedRecordLayout(moduleKey, "quick_create", open);
  const { fields: moduleFields } = useModuleFieldConfigs(moduleKey);

  const contextDefaultsKey = JSON.stringify(context?.defaults ?? null);
  const initialForm = useMemo(
    () => ({ ...emptyForm, ...(context?.defaults ?? {}) }) as TForm,
    // `emptyForm` is a module-level constant and `contextDefaultsKey` covers the defaults.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contextDefaultsKey],
  );

  const [form, setForm] = useState<TForm>(initialForm);
  const [customFieldValues, setCustomFieldValues] = useState<Record<string, unknown>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const layout = layoutQuery.data;
  const pristineSnapshot = useMemo(
    () => JSON.stringify([initialForm, {}]),
    [initialForm],
  );

  /** Prefilled context is not "unsaved work" — only what the user typed on top of it is. */
  const isDirty = useMemo(
    () => JSON.stringify([form, customFieldValues]) !== pristineSnapshot,
    [customFieldValues, form, pristineSnapshot],
  );

  const reset = useCallback(() => {
    setForm(initialForm);
    setCustomFieldValues({});
    setErrors({});
    setSubmitError(null);
  }, [initialForm]);

  useEffect(() => {
    if (!open) reset();
  }, [open, reset]);

  // Reopening from a different record must not carry the previous record's context.
  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contextDefaultsKey]);

  const focusField = useCallback(
    (fieldKey: string) => {
      window.requestAnimationFrame(() => document.getElementById(inputId(fieldKey))?.focus());
    },
    [inputId],
  );

  const setCustomFieldValue = useCallback((fieldKey: string, value: unknown) => {
    setCustomFieldValues((current) => ({ ...current, [fieldKey]: value }));
  }, []);

  async function handleSubmit(outcome: QuickCreateOutcome) {
    setSubmitError(null);
    if (!layout) {
      setSubmitError("The layout is still loading. Try again in a moment.");
      return;
    }

    const nextErrors = validate({ layout, form, customFieldValues });
    setErrors(nextErrors);
    const firstInvalidField = Object.keys(nextErrors)[0];
    if (firstInvalidField) {
      focusField(firstInvalidField);
      return;
    }

    setIsSubmitting(true);
    try {
      const createdId = await save({ form, customFieldValues, moduleFields });
      await onCreated(createdId, outcome);
    } catch (error) {
      const failure = describeSubmitError(error);
      setSubmitError(failure.message);
      if (failure.focusFieldKey) focusField(failure.focusFieldKey);
    } finally {
      setIsSubmitting(false);
    }
  }

  const invalidFieldCount = Object.keys(errors).length;

  return {
    layoutQuery,
    layout,
    moduleFields,
    form,
    setForm,
    customFieldValues,
    setCustomFieldValue,
    errors,
    invalidFieldCount,
    submitError,
    isDirty,
    isSubmitting,
    handleSubmit,
    reset,
  };
}
