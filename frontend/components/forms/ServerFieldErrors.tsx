"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { FieldError } from "@/components/ui/field";
import { focusFirstFieldError, formErrorMessage, formFieldErrors, type FieldErrors } from "@/lib/apiErrors";
import { formatSnakeCaseLabel } from "@/lib/module-display";

/**
 * The server's field errors, keyed by input id, for whatever form is below (13 §7 Step 3, H2).
 *
 * A form knows its payload (`primary_email`) and its inputs (`lead-primary-email`); the
 * fields know only their id. So the form maps one to the other once, here, and `TextField`
 * and `CustomFieldInput` read their own message without a prop threaded through every
 * section. A composed field (a picker, a select) shows its message with `ServerFieldError`.
 */
const ServerFieldErrorsContext = createContext<Record<string, string>>({});

export function ServerFieldErrorsProvider({
  errors,
  inputIdFor,
  children,
}: {
  errors: FieldErrors;
  /** Payload path → input id. Custom fields (`custom_fields.<key>`) are mapped by default. */
  inputIdFor: (path: string) => string | null | undefined;
  children: ReactNode;
}) {
  const byInputId = useMemo(() => {
    const next: Record<string, string> = {};
    for (const [path, message] of Object.entries(errors)) {
      const id = inputIdFor(path);
      if (id) next[id] = message;
    }
    return next;
  }, [errors, inputIdFor]);
  return <ServerFieldErrorsContext.Provider value={byInputId}>{children}</ServerFieldErrorsContext.Provider>;
}

/** The server's message for one input, or null. */
export function useServerFieldError(inputId: string): string | null {
  return useContext(ServerFieldErrorsContext)[inputId] ?? null;
}

/** For a composed field that is not a `TextField`: the server's message under it, if any. */
export function ServerFieldError({ inputId }: { inputId: string }) {
  const error = useServerFieldError(inputId);
  return error ? <FieldError id={`${inputId}-error`}>{error}</FieldError> : null;
}

/** The input id `CustomFieldInput` gives a custom field, for a form's `inputIdFor`. */
export function customFieldInputId(moduleKey: string, path: string): string | null {
  return path.startsWith("custom_fields.") ? `custom-field-${moduleKey}-${path.slice("custom_fields.".length)}` : null;
}

/**
 * A form's save-failure state: the field errors for `ServerFieldErrorsProvider`, and the
 * banner's sentence. An error the form has no input for (a field hidden by the layout) is
 * named in the banner, so "Check the highlighted field" never points at nothing.
 */
export function useServerFormErrors(inputIdFor: (path: string) => string | null | undefined) {
  const [errors, setErrors] = useState<FieldErrors>({});
  const [message, setMessage] = useState<string | null>(null);

  const report = useCallback(
    (error: unknown, fallback: string) => {
      const fieldErrors = formFieldErrors(error);
      const unplaced = Object.entries(fieldErrors).filter(([path]) => !inputIdFor(path));
      const placed = Object.keys(fieldErrors).length - unplaced.length;
      let next = formErrorMessage(error, fallback);
      if (unplaced.length) {
        const named = unplaced.map(([path, text]) => `${formatSnakeCaseLabel(path)}: ${text}`).join(" ");
        next = placed ? `${next} ${named}` : named;
      }
      setErrors(fieldErrors);
      setMessage(next);
      focusFirstFieldError(fieldErrors, inputIdFor);
    },
    [inputIdFor],
  );

  const clear = useCallback(() => {
    setErrors({});
    setMessage(null);
  }, []);

  return { errors, message, report, clear };
}

/** `inputIdFor` from a fixed map, with custom fields mapped for `moduleKey`. */
export function inputIdLookup(moduleKey: string, ids: Record<string, string>) {
  return (path: string) => ids[path] ?? customFieldInputId(moduleKey, path);
}
