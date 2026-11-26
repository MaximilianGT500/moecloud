export const FEATURES = ['photos', 'music', 'notes', 'forms', 'tags', 'calendar', 'tasks', 'booking', 'polls', 'contacts'] as const;

export type Feature = (typeof FEATURES)[number];

export const isFeature = (value: unknown): value is Feature => typeof value === 'string' && (FEATURES as readonly string[]).includes(value);
