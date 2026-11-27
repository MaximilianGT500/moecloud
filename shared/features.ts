export const FEATURES = [
  'photos',
  'music',
  'notes',
  'forms',
  'tags',
  'calendar',
  'tasks',
  'booking',
  'polls',
  'contacts',
  'mail',
  'chat',
  'bookmarks',
  'feeds',
  'snippets',
] as const;

export type Feature = (typeof FEATURES)[number];

export const isFeature = (value: unknown): value is Feature => typeof value === 'string' && (FEATURES as readonly string[]).includes(value);

export const FEATURE_PARENT: Partial<Record<Feature, Feature>> = { tasks: 'calendar', booking: 'calendar', polls: 'calendar' };

export const FEATURE_SETTING = {
  photos: 'photos.enabled',
  music: 'music.enabled',
  notes: 'notes.enabled',
  forms: 'forms.enabled',
  tags: 'tags.enabled',
  calendar: 'calendar.enabled',
  tasks: 'tasks.enabled',
  booking: 'calendar.booking',
  polls: 'calendar.polls',
  contacts: 'contacts.enabled',
  mail: 'webmail.enabled',
  chat: 'chat.enabled',
  bookmarks: 'bookmarks.enabled',
  feeds: 'feeds.enabled',
  snippets: 'snippets.enabled',
} as const satisfies Record<Feature, string>;
