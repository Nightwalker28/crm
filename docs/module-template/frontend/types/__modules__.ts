export type __Module__ = {
  __id_field__: number;
  name: string | null;
  description: string | null;
  status: string | null;
  assigned_to: number | null;
  created_time: string;
  updated_at?: string | null;
  custom_fields?: Record<string, unknown> | null;
};

export type __Module__ListResponse = {
  results: __Module__[];
  range_start: number;
  range_end: number;
  total_count: number;
  total_pages: number;
  page: number;
};

export type __Module__CreateRequest = {
  name: string;
  description?: string | null;
  status?: string;
  assigned_to?: number | null;
  custom_fields?: Record<string, unknown> | null;
};

export type __Module__UpdateRequest = Partial<__Module__CreateRequest>;
